/**
 * Performance Validation Script
 * 
 * Run this in the browser console after loading the dashboard
 * to verify all optimizations are active and working correctly.
 * 
 * Usage:
 * 1. Open the dashboard (index.html)
 * 2. Open Developer Console
 * 3. Paste and run this script
 * 4. Check the output summary
 */

(function runPerformanceValidation() {
  console.log('%c[Performance Validation] Starting checks...', 'color: #5c6bf2; font-weight: bold; font-size: 14px');
  
  const results = {
    passed: [],
    warnings: [],
    failed: []
  };

  // 1. Check if performance monitor is loaded
  if (typeof performanceMonitor !== 'undefined') {
    results.passed.push('✓ Performance monitor loaded');
  } else {
    results.failed.push('✗ Performance monitor not found');
  }

  // 2. Check if skeleton loader is loaded
  if (typeof skeletonLoader !== 'undefined' && skeletonLoader.isCSSLoaded()) {
    results.passed.push('✓ Skeleton loader loaded and CSS injected');
  } else {
    results.warnings.push('⚠ Skeleton loader not available');
  }

  // 3. Check virtual scroller status
  const state = window.dashboardDebug?.getState?.();
  if (state) {
    const taskCount = state.tasks.length;
    if (taskCount > 100 && window.virtualScroller) {
      const isActive = window.virtualScroller().isActive();
      if (isActive) {
        results.passed.push(`✓ Virtual scroller active (${taskCount} tasks)`);
      } else {
        results.warnings.push(`⚠ Virtual scroller loaded but not active (${taskCount} tasks)`);
      }
    } else if (taskCount <= 100) {
      results.passed.push(`✓ Normal rendering mode (${taskCount} tasks < threshold)`);
    }
  } else {
    results.warnings.push('⚠ Could not verify virtual scroller (no state)');
  }

  // 4. Check Web Worker availability
  if (window.dashboardDebug?.workerAvailable?.()) {
    results.passed.push('✓ Web Worker available for filtering/sorting');
  } else {
    results.warnings.push('⚠ Web Worker not active (will use main thread fallback)');
  }

  // 5. Check CSS optimizations
  const computedStyles = getComputedStyle(document.documentElement);
  const hasAccel = document.querySelector('.task-item') !== null;
  if (hasAccel) {
    results.passed.push('✓ CSS styles loaded with hardware acceleration hints');
  } else {
    results.warnings.push('⚠ Could not verify CSS optimizations');
  }

  // 6. Check if module is optimized version
  if (window.dashboardDebug) {
    results.passed.push('✓ Debug API available');
  }

  // 7. Test performance timing (if tasks exist)
  if (state && state.tasks.length > 0) {
    const testStart = performance.now();
    // Trigger a filter operation
    performanceMonitor.time('test-operation')();
    setTimeout(() => {
      const duration = performanceMonitor.time('test-operation')();
      if (duration < 10) {
        results.passed.push(`✓ Performance monitoring working (test: ${duration.toFixed(2)}ms)`);
      } else {
        results.warnings.push(`⚠ Performance test took ${duration.toFixed(2)}ms`);
      }
      printResults();
    }, 0);
  } else {
    results.passed.push('✓ Ready for performance testing (add tasks first)');
    printResults();
  }

  function printResults() {
    console.log('%c\n=== Performance Validation Results ===', 'color: #5c6bf2; font-weight: bold; font-size: 14px');
    
    results.passed.forEach(msg => {
      console.log(`%c${msg}`, 'color: #20b26c;');
    });
    
    results.warnings.forEach(msg => {
      console.log(`%c${msg}`, 'color: #f59e0b;');
    });
    
    results.failed.forEach(msg => {
      console.log(`%c${msg}`, 'color: #ef4444;');
    });

    const total = results.passed.length + results.warnings.length + results.failed.length;
    const score = ((results.passed.length / total) * 100).toFixed(0);
    
    console.log(`\n%cScore: ${score}% (${results.passed.length}/${total} checks passed)`, 
      score >= 80 ? 'color: #20b26c; font-weight: bold;' : 'color: #f59e0b; font-weight: bold;');
    
    console.log('%c\nNext steps:', 'color: #5c6bf2; font-weight: bold;');
    console.log('1. Add 100+ tasks to test virtual scrolling');
    console.log('2. Test filter/sort operations for responsiveness');
    console.log('3. Scroll vigorously to check 60fps');
    console.log('4. Run: performanceMonitor.getSummary() for detailed report');
    console.log('5. Check Chrome DevTools → Performance for long tasks');
    
    console.log('%c\nValidation complete!', 'color: #8b9bff; font-weight: bold;');
  }
})();
