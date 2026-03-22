/**
 * OpenClaw Dashboard - Shared Theme Manager
 * 
 * Handles dark/light mode toggling with localStorage persistence.
 * Automatically detects system preference as fallback.
 */

(function() {
    const STORAGE_KEY = 'openclaw-dashboard-theme';
    const DARK_THEME = 'dark';
    const LIGHT_THEME = 'light';

    /**
     * Get saved theme from localStorage
     */
    function getSavedTheme() {
        try {
            return localStorage.getItem(STORAGE_KEY);
        } catch (e) {
            return null;
        }
    }

    /**
     * Get system color scheme preference
     */
    function getSystemPreference() {
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            return DARK_THEME;
        }
        return LIGHT_THEME;
    }

    /**
     * Apply theme to document
     */
    function applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        updateToggleButtons(theme);
    }

    /**
     * Update all theme toggle buttons to reflect current theme
     */
    function updateToggleButtons(theme) {
        const buttons = document.querySelectorAll('.theme-toggle');
        buttons.forEach(function(btn) {
            const icon = btn.querySelector('.theme-toggle-icon');
            const label = btn.querySelector('.theme-toggle-label');
            
            if (icon) {
                icon.textContent = theme === DARK_THEME ? '☀️' : '🌙';
            }
            if (label) {
                label.textContent = theme === DARK_THEME ? 'Light' : 'Dark';
            }
        });
    }

    /**
     * Toggle between light and dark themes
     */
    function toggleTheme() {
        const currentTheme = document.documentElement.getAttribute('data-theme') || LIGHT_THEME;
        const newTheme = currentTheme === DARK_THEME ? LIGHT_THEME : DARK_THEME;

        try {
            localStorage.setItem(STORAGE_KEY, newTheme);
        } catch (e) {
            // localStorage unavailable, continue anyway
        }

        applyTheme(newTheme);
    }

    /**
     * Initialize theme system
     */
    function init() {
        // Apply initial theme
        const savedTheme = getSavedTheme();
        const initialTheme = savedTheme || getSystemPreference();
        applyTheme(initialTheme);

        // Set up toggle buttons
        document.addEventListener('DOMContentLoaded', function() {
            const buttons = document.querySelectorAll('.theme-toggle');
            buttons.forEach(function(btn) {
                btn.addEventListener('click', toggleTheme);
            });

            // Listen for system preference changes
            if (window.matchMedia) {
                window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function(e) {
                    // Only auto-switch if user hasn't set a preference
                    if (!getSavedTheme()) {
                        applyTheme(e.matches ? DARK_THEME : LIGHT_THEME);
                    }
                });
            }
            
            // Update buttons after DOM is ready
            updateToggleButtons(initialTheme);
        });
    }

    // Run immediately
    init();

    // Export for external use if needed
    window.DashboardTheme = {
        toggle: toggleTheme,
        apply: applyTheme,
        getCurrent: function() {
            return document.documentElement.getAttribute('data-theme') || LIGHT_THEME;
        },
        DARK: DARK_THEME,
        LIGHT: LIGHT_THEME
    };
})();
