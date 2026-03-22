/**
 * IndexedDB Helper for OpenClaw Dashboard
 * 
 * Provides a simple wrapper around IndexedDB for storing:
 * - tasks (large payloads)
 * - sync queue (offline mutations)
 * - cached API responses
 * 
 * Uses Web Crypto API for encrypting sensitive fields (if any)
 */

export const DB_NAME = 'OpenClawDashboardDB';
export const DB_VERSION = 3; // Increment on schema changes

// Store names
export const STORES = {
  TASKS: 'tasks',
  SYNC_QUEUE: 'syncQueue',
  CACHE: 'apiCache'
};

/**
 * Simple encryption/decryption for sensitive data
 * Uses Web Crypto API with AES-GCM
 * Note: Dashboard currently has no secrets, but this is available if needed
 */
const CryptoUtils = {
  async deriveKey(password) {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      enc.encode(password),
      { name: 'PBKDF2' },
      false,
      ['deriveBits', 'deriveKey']
    );
    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: enc.encode('openclaw-dashboard-salt'),
        iterations: 100000,
        hash: 'SHA-256'
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  },

  async encrypt(data, key) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const enc = new TextEncoder();
    const encoded = enc.encode(JSON.stringify(data));
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      encoded
    );
    return {
      iv: Array.from(iv),
      data: Array.from(new Uint8Array(ciphertext))
    };
  },

  async decrypt(encrypted, key) {
    const dec = new TextDecoder();
    const iv = new Uint8Array(encrypted.iv);
    const data = new Uint8Array(encrypted.data);
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      data
    );
    return JSON.parse(dec.decode(plaintext));
  }
};

/**
 * IndexedDB Wrapper Class
 */
class IDBWrapper {
  constructor() {
    this.db = null;
    this.encryptionKey = null;
  }

  /**
   * Initialize the database
   * @returns {Promise<IDBDatabase>}
   */
  async init() {
    return new Promise((resolve, reject) => {
      if (this.db) {
        resolve(this.db);
        return;
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Create object stores if they don't exist
        if (!db.objectStoreNames.contains(STORES.TASKS)) {
          const taskStore = db.createObjectStore(STORES.TASKS, { keyPath: 'id' });
          taskStore.createIndex('category', 'category', { unique: false });
          taskStore.createIndex('completed', 'completed', { unique: false });
          taskStore.createIndex('updatedAt', 'updatedAt', { unique: false });
        }

        if (!db.objectStoreNames.contains(STORES.SYNC_QUEUE)) {
          const syncStore = db.createObjectStore(STORES.SYNC_QUEUE, { keyPath: 'id', autoIncrement: true });
          syncStore.createIndex('timestamp', 'timestamp', { unique: false });
          syncStore.createIndex('operation', 'operation', { unique: false });
        }

        if (!db.objectStoreNames.contains(STORES.CACHE)) {
          const cacheStore = db.createObjectStore(STORES.CACHE, { keyPath: 'url' });
          cacheStore.createIndex('timestamp', 'timestamp', { unique: false });
        }

        this.db = db;
      };
    });
  }

  /**
   * Initialize encryption key (optional - only if storing sensitive data)
   * Currently dashboard has no secrets, so this is available but not used
   */
  async initEncryption(password = 'default-dashboard-key') {
    try {
      this.encryptionKey = await CryptoUtils.deriveKey(password);
    } catch (error) {
      console.warn('Encryption initialization failed, operating without encryption:', error);
    }
  }

  /**
   * Add a document to a store
   * @param {string} storeName - The object store name
   * @param {Object} document - The document to store
   * @param {boolean} encrypt - Whether to encrypt the document (default: false)
   */
  async add(storeName, document, encrypt = false) {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([storeName], 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.add(document);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Put (update or insert) a document
   * @param {string} storeName - The object store name
   * @param {Object} document - The document to store
   * @param {boolean} encrypt - Whether to encrypt the document
   */
  async put(storeName, document, encrypt = false) {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([storeName], 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.put(document);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get a document by key
   * @param {string} storeName - The object store name
   * @param {any} key - The document key
   * @param {boolean} decrypt - Whether to decrypt the document
   */
  async get(storeName, key, decrypt = false) {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([storeName], 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.get(key);

      request.onsuccess = () => {
        let data = request.result;
        // For now, no decryption (dashboard has no secrets)
        resolve(data);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get all documents from a store (with optional index query)
   * @param {string} storeName - The object store name
   * @param {string} indexName - Optional index name
   * @param {any} value - Optional value for index query
   * @returns {Promise<Array>}
   */
  async getAll(storeName, indexName = null, value = null) {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([storeName], 'readonly');
      let request;
      const store = transaction.objectStore(storeName);

      if (indexName && value) {
        const index = store.index(indexName);
        request = index.getAll(value);
      } else {
        request = store.getAll();
      }

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Delete a document by key
   * @param {string} storeName - The object store name
   * @param {any} key - The document key
   */
  async delete(storeName, key) {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([storeName], 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.delete(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Clear an entire store
   * @param {string} storeName - The object store name
   */
  async clear(storeName) {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([storeName], 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.clear();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Count documents in a store
   * @param {string} storeName - The object store name
   */
  async count(storeName) {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([storeName], 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Close the database connection
   */
  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

// Export classes and utilities
export { IDBWrapper, CryptoUtils };

// Export singleton instance
export const idb = new IDBWrapper();
