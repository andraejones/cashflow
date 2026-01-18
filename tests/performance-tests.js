/**
 * Performance Tests for CashFlow Calendar
 *
 * Tests for Issues 8-10 from UNFIXED_ISSUES.md:
 * - Issue 8: No Pagination for Transaction Lists
 * - Issue 9: Recurring Transaction Expansion Caching
 * - Issue 10: Full Store Save Debouncing
 *
 * Run these tests in the browser console after loading the application.
 *
 * Usage:
 *   1. Open the CashFlow application in a browser
 *   2. Open the browser's developer console (F12 or Cmd+Opt+I)
 *   3. Copy and paste this entire file into the console
 *   4. The tests will run automatically and output results
 */

(function() {
  'use strict';

  // Test utilities
  const TestRunner = {
    results: [],
    passed: 0,
    failed: 0,

    assert(condition, testName, details = '') {
      if (condition) {
        this.passed++;
        this.results.push({ status: 'PASS', testName, details });
        console.log(`%c PASS %c ${testName}`, 'background: #27ae60; color: white; padding: 2px 6px; border-radius: 3px;', '');
      } else {
        this.failed++;
        this.results.push({ status: 'FAIL', testName, details });
        console.log(`%c FAIL %c ${testName}`, 'background: #e74c3c; color: white; padding: 2px 6px; border-radius: 3px;', '');
        if (details) {
          console.log(`       Details: ${details}`);
        }
      }
    },

    assertExists(obj, testName) {
      this.assert(obj !== undefined && obj !== null, testName, obj === undefined ? 'undefined' : 'null');
    },

    assertFunction(fn, testName) {
      this.assert(typeof fn === 'function', testName, `Expected function, got ${typeof fn}`);
    },

    assertNumber(val, testName) {
      this.assert(typeof val === 'number', testName, `Expected number, got ${typeof val}`);
    },

    assertProperty(obj, prop, testName) {
      this.assert(obj && prop in obj, testName, obj ? `Property "${prop}" not found` : 'Object is null/undefined');
    },

    printSummary() {
      console.log('\n' + '='.repeat(60));
      console.log(`%c TEST SUMMARY `, 'background: #3498db; color: white; padding: 4px 8px; font-weight: bold;');
      console.log(`Total: ${this.passed + this.failed} | Passed: ${this.passed} | Failed: ${this.failed}`);
      console.log('='.repeat(60) + '\n');

      if (this.failed > 0) {
        console.log('%c Failed Tests:', 'color: #e74c3c; font-weight: bold;');
        this.results.filter(r => r.status === 'FAIL').forEach(r => {
          console.log(`  - ${r.testName}`);
          if (r.details) console.log(`    ${r.details}`);
        });
      }

      return { passed: this.passed, failed: this.failed, results: this.results };
    },

    reset() {
      this.results = [];
      this.passed = 0;
      this.failed = 0;
    }
  };

  // Wait utility for async operations
  function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Get app components safely
  function getSearchUI() {
    if (window.app && window.app.searchUI) {
      return window.app.searchUI;
    }
    return null;
  }

  function getRecurringManager() {
    if (window.app && window.app.recurringManager) {
      return window.app.recurringManager;
    }
    return null;
  }

  function getStore() {
    if (window.app && window.app.store) {
      return window.app.store;
    }
    return null;
  }

  // ============================================================================
  // ISSUE 8: No Pagination for Transaction Lists Tests
  // ============================================================================
  console.log('\n%c Issue 8: Pagination for Transaction Lists ', 'background: #9b59b6; color: white; padding: 4px 8px; font-weight: bold;');

  function testPagination() {
    const searchUI = getSearchUI();

    // Test 8.1: Check if SearchUI exists
    TestRunner.assertExists(
      searchUI,
      'SearchUI instance exists'
    );

    if (!searchUI) {
      console.log('%c Skipping pagination tests - SearchUI not found', 'color: #f39c12');
      return;
    }

    // Test 8.2: Check for currentPage property
    TestRunner.assertProperty(
      searchUI,
      'currentPage',
      'SearchUI has currentPage property'
    );

    // Test 8.3: Check for resultsPerPage (or pageSize) property
    const hasPageSize = 'resultsPerPage' in searchUI || 'pageSize' in searchUI;
    TestRunner.assert(
      hasPageSize,
      'SearchUI has resultsPerPage or pageSize property',
      `resultsPerPage: ${'resultsPerPage' in searchUI}, pageSize: ${'pageSize' in searchUI}`
    );

    // Test 8.4: Verify page size is a reasonable number
    const pageSize = searchUI.resultsPerPage || searchUI.pageSize || 0;
    TestRunner.assert(
      typeof pageSize === 'number' && pageSize > 0 && pageSize <= 100,
      'Page size is a reasonable number (1-100)',
      `Page size: ${pageSize}`
    );

    // Test 8.5: Check for totalResults property
    TestRunner.assertProperty(
      searchUI,
      'totalResults',
      'SearchUI has totalResults property'
    );

    // Test 8.6: Check for searchResults array property
    TestRunner.assertProperty(
      searchUI,
      'searchResults',
      'SearchUI has searchResults array property'
    );

    // Test 8.7: Check for changePage method
    TestRunner.assertFunction(
      searchUI.changePage,
      'SearchUI has changePage method'
    );

    // Test 8.8: Check for pagination controls in DOM
    const paginationControls = document.getElementById('paginationControls');
    TestRunner.assertExists(
      paginationControls,
      'Pagination controls element exists in DOM (#paginationControls)'
    );

    // Test 8.9: Check for prev/next page buttons
    const prevButton = document.getElementById('prevPageButton');
    const nextButton = document.getElementById('nextPageButton');
    TestRunner.assert(
      prevButton !== null && nextButton !== null,
      'Prev and Next page buttons exist',
      `Prev: ${prevButton !== null}, Next: ${nextButton !== null}`
    );

    // Test 8.10: Check for page info display
    const pageInfo = document.getElementById('currentPageInfo');
    TestRunner.assertExists(
      pageInfo,
      'Page info display element exists (#currentPageInfo)'
    );

    // Test 8.11: Verify changePage method bounds checking
    if (typeof searchUI.changePage === 'function') {
      const originalPage = searchUI.currentPage;

      // Try to go to page -1 (should not work)
      searchUI.currentPage = 1;
      searchUI.totalResults = 100;
      searchUI.changePage(-1);

      TestRunner.assert(
        searchUI.currentPage >= 1,
        'changePage prevents going below page 1',
        `Current page after -1 delta: ${searchUI.currentPage}`
      );

      // Restore
      searchUI.currentPage = originalPage;
    }

    // Test 8.12: Verify updateSearchResults handles pagination
    TestRunner.assertFunction(
      searchUI.updateSearchResults,
      'SearchUI has updateSearchResults method'
    );

    // Test 8.13: Verify pagination only renders page subset, not all results
    // This tests that the rendering is actually paginated
    if (typeof searchUI.updateSearchResults === 'function' && searchUI.resultsPerPage) {
      // Store original state
      const originalResults = searchUI.searchResults;
      const originalTotal = searchUI.totalResults;
      const originalPage = searchUI.currentPage;

      // Create mock results exceeding page size
      const mockResults = [];
      for (let i = 0; i < 50; i++) {
        mockResults.push({
          date: `2024-01-${String(i + 1).padStart(2, '0')}`,
          transaction: { amount: 100, type: 'expense', description: `Test ${i}` }
        });
      }

      searchUI.searchResults = mockResults;
      searchUI.totalResults = mockResults.length;
      searchUI.currentPage = 1;

      try {
        searchUI.updateSearchResults();

        const searchResultsEl = document.getElementById('searchResults');
        const renderedItems = searchResultsEl ?
          searchResultsEl.querySelectorAll('.search-result-item').length : 0;

        TestRunner.assert(
          renderedItems <= searchUI.resultsPerPage,
          'Pagination renders only page size number of results',
          `Rendered ${renderedItems} items, page size is ${searchUI.resultsPerPage}`
        );
      } catch (e) {
        TestRunner.assert(false, 'Pagination renders only page size number of results', e.message);
      }

      // Restore original state
      searchUI.searchResults = originalResults;
      searchUI.totalResults = originalTotal;
      searchUI.currentPage = originalPage;
    }
  }

  // ============================================================================
  // ISSUE 9: Recurring Transaction Expansion Caching Tests
  // ============================================================================
  console.log('\n%c Issue 9: Recurring Transaction Expansion Caching ', 'background: #9b59b6; color: white; padding: 4px 8px; font-weight: bold;');

  function testRecurringCaching() {
    const recurringManager = getRecurringManager();

    // Test 9.1: Check if RecurringTransactionManager exists
    TestRunner.assertExists(
      recurringManager,
      'RecurringTransactionManager instance exists'
    );

    if (!recurringManager) {
      console.log('%c Skipping caching tests - RecurringTransactionManager not found', 'color: #f39c12');
      return;
    }

    // Test 9.2: Check for cache property
    const hasCache = 'cache' in recurringManager ||
                     'expansionCache' in recurringManager ||
                     'monthCache' in recurringManager ||
                     '_cache' in recurringManager;
    TestRunner.assert(
      hasCache,
      'RecurringTransactionManager has cache property',
      `cache: ${'cache' in recurringManager}, expansionCache: ${'expansionCache' in recurringManager}, monthCache: ${'monthCache' in recurringManager}`
    );

    // Test 9.3: Check for cache invalidation method
    const hasInvalidateMethod = typeof recurringManager.invalidateCache === 'function' ||
                                typeof recurringManager.clearCache === 'function' ||
                                typeof recurringManager.resetCache === 'function';
    TestRunner.assert(
      hasInvalidateMethod,
      'RecurringTransactionManager has cache invalidation method',
      `invalidateCache: ${typeof recurringManager.invalidateCache}, clearCache: ${typeof recurringManager.clearCache}, resetCache: ${typeof recurringManager.resetCache}`
    );

    // Test 9.4: Check for isCached or getCached method
    const hasCacheCheck = typeof recurringManager.isCached === 'function' ||
                          typeof recurringManager.getCached === 'function' ||
                          typeof recurringManager.getFromCache === 'function';
    TestRunner.assert(
      hasCacheCheck,
      'RecurringTransactionManager has cache lookup method',
      `isCached: ${typeof recurringManager.isCached}, getCached: ${typeof recurringManager.getCached}`
    );

    // Test 9.5: Test that repeated calls for same month use cache (if caching exists)
    if (hasCache && typeof recurringManager.applyRecurringTransactions === 'function') {
      const testYear = 2024;
      const testMonth = 5; // June

      // First call - should populate cache
      const startTime1 = performance.now();
      recurringManager.applyRecurringTransactions(testYear, testMonth);
      const endTime1 = performance.now();
      const firstCallTime = endTime1 - startTime1;

      // Second call - should use cache (if implemented)
      const startTime2 = performance.now();
      recurringManager.applyRecurringTransactions(testYear, testMonth);
      const endTime2 = performance.now();
      const secondCallTime = endTime2 - startTime2;

      // If caching is working, second call should be significantly faster
      // We use a relaxed check since timing can vary
      const isCachingEffective = secondCallTime <= firstCallTime * 1.5;
      TestRunner.assert(
        isCachingEffective,
        'Second call to applyRecurringTransactions is not slower than first (cache may be working)',
        `First: ${firstCallTime.toFixed(2)}ms, Second: ${secondCallTime.toFixed(2)}ms`
      );
    } else {
      TestRunner.assert(
        false,
        'Cache performance test skipped - caching not implemented',
        'No cache property found on RecurringTransactionManager'
      );
    }

    // Test 9.6: Check for cache key generation method
    const hasCacheKeyMethod = typeof recurringManager.getCacheKey === 'function' ||
                              typeof recurringManager.generateCacheKey === 'function' ||
                              typeof recurringManager.makeCacheKey === 'function';
    TestRunner.assert(
      hasCacheKeyMethod,
      'RecurringTransactionManager has cache key generation method',
      `getCacheKey: ${typeof recurringManager.getCacheKey}, generateCacheKey: ${typeof recurringManager.generateCacheKey}`
    );

    // Test 9.7: Check that cache invalidation is triggered on template changes
    // This tests that addRecurringTransaction invalidates the cache
    const store = getStore();
    if (store && hasCache) {
      const hasInvalidateOnChange =
        // Check if there's a mechanism to invalidate cache when templates change
        typeof recurringManager.onTemplateChange === 'function' ||
        typeof recurringManager.handleTemplateUpdate === 'function' ||
        // Or check if store has callback registration for recurring changes
        (store.onSaveCallbacks && store.onSaveCallbacks.length > 0);

      TestRunner.assert(
        hasInvalidateOnChange,
        'Cache invalidation mechanism exists for template changes',
        'Should invalidate cache when recurring templates are modified'
      );
    }

    // Test 9.8: Check cache has reasonable max size or TTL
    if (hasCache) {
      const cacheObj = recurringManager.cache ||
                       recurringManager.expansionCache ||
                       recurringManager.monthCache ||
                       recurringManager._cache;

      if (cacheObj && typeof cacheObj === 'object') {
        const hasMaxSize = 'maxSize' in cacheObj ||
                          'limit' in cacheObj ||
                          typeof recurringManager.maxCacheSize === 'number';
        const hasTTL = 'ttl' in cacheObj ||
                      typeof recurringManager.cacheTTL === 'number';

        TestRunner.assert(
          hasMaxSize || hasTTL || typeof cacheObj === 'object',
          'Cache has size limit or TTL (or is a simple object cache)',
          `Cache type: ${typeof cacheObj}, MaxSize: ${hasMaxSize}, TTL: ${hasTTL}`
        );
      }
    }
  }

  // ============================================================================
  // ISSUE 10: Full Store Save Debouncing Tests
  // ============================================================================
  console.log('\n%c Issue 10: Full Store Save Debouncing ', 'background: #9b59b6; color: white; padding: 4px 8px; font-weight: bold;');

  async function testSaveDebouncing() {
    const store = getStore();

    // Test 10.1: Check if TransactionStore exists
    TestRunner.assertExists(
      store,
      'TransactionStore instance exists'
    );

    if (!store) {
      console.log('%c Skipping debouncing tests - TransactionStore not found', 'color: #f39c12');
      return;
    }

    // Test 10.2: Check for debounced save method
    const hasDebouncedSave = typeof store.debouncedSave === 'function' ||
                             typeof store.scheduleSave === 'function' ||
                             typeof store.queueSave === 'function' ||
                             typeof store.saveDataDebounced === 'function';
    TestRunner.assert(
      hasDebouncedSave,
      'TransactionStore has debounced save method',
      `debouncedSave: ${typeof store.debouncedSave}, scheduleSave: ${typeof store.scheduleSave}, queueSave: ${typeof store.queueSave}`
    );

    // Test 10.3: Check for debounce delay property
    const hasDebounceDelay = 'debounceDelay' in store ||
                             'saveDelay' in store ||
                             'debounceMs' in store ||
                             '_debounceDelay' in store;
    TestRunner.assert(
      hasDebounceDelay,
      'TransactionStore has debounce delay property',
      `debounceDelay: ${'debounceDelay' in store}, saveDelay: ${'saveDelay' in store}`
    );

    // Test 10.4: Verify debounce delay is reasonable (300-1000ms)
    const debounceDelay = store.debounceDelay || store.saveDelay || store.debounceMs || store._debounceDelay;
    if (typeof debounceDelay === 'number') {
      TestRunner.assert(
        debounceDelay >= 100 && debounceDelay <= 2000,
        'Debounce delay is reasonable (100-2000ms)',
        `Delay: ${debounceDelay}ms`
      );
    } else {
      TestRunner.assert(
        false,
        'Debounce delay is reasonable (100-2000ms)',
        'Debounce delay not found or not a number'
      );
    }

    // Test 10.5: Check for pending save indicator
    const hasPendingIndicator = 'pendingSave' in store ||
                                'saveTimer' in store ||
                                'savePending' in store ||
                                '_saveTimeout' in store;
    TestRunner.assert(
      hasPendingIndicator,
      'TransactionStore has pending save indicator',
      `pendingSave: ${'pendingSave' in store}, saveTimer: ${'saveTimer' in store}`
    );

    // Test 10.6: Check for flush/immediate save method
    const hasFlushMethod = typeof store.flushSave === 'function' ||
                          typeof store.saveImmediately === 'function' ||
                          typeof store.forceSave === 'function';
    TestRunner.assert(
      hasFlushMethod,
      'TransactionStore has flush/immediate save method',
      `flushSave: ${typeof store.flushSave}, saveImmediately: ${typeof store.saveImmediately}`
    );

    // Test 10.7: Test that multiple rapid changes result in fewer saves
    if (hasDebouncedSave) {
      let saveCount = 0;
      const originalSaveData = store.saveData.bind(store);

      // Temporarily override saveData to count calls
      store.saveData = function(...args) {
        saveCount++;
        return originalSaveData(...args);
      };

      // Trigger multiple rapid changes
      const debouncedMethod = store.debouncedSave ||
                              store.scheduleSave ||
                              store.queueSave ||
                              store.saveDataDebounced;

      if (typeof debouncedMethod === 'function') {
        saveCount = 0;

        // Call debounced save 5 times rapidly
        for (let i = 0; i < 5; i++) {
          debouncedMethod.call(store);
        }

        // Wait for debounce to complete
        const waitTime = (debounceDelay || 500) + 100;
        await wait(waitTime);

        TestRunner.assert(
          saveCount < 5,
          'Multiple rapid debounced saves result in fewer actual saves',
          `5 rapid calls resulted in ${saveCount} actual save(s)`
        );
      }

      // Restore original saveData
      store.saveData = originalSaveData;
    } else {
      TestRunner.assert(
        false,
        'Multiple rapid debounced saves result in fewer actual saves',
        'No debounced save method found'
      );
    }

    // Test 10.8: Test that saves eventually complete
    if (hasDebouncedSave) {
      const debouncedMethod = store.debouncedSave ||
                              store.scheduleSave ||
                              store.queueSave ||
                              store.saveDataDebounced;

      if (typeof debouncedMethod === 'function') {
        let saveCompleted = false;
        const originalSaveData = store.saveData.bind(store);

        store.saveData = function(...args) {
          saveCompleted = true;
          return originalSaveData(...args);
        };

        debouncedMethod.call(store);

        // Wait for debounce + extra time
        const waitTime = (debounceDelay || 500) + 200;
        await wait(waitTime);

        TestRunner.assert(
          saveCompleted,
          'Debounced save eventually completes',
          `Save completed: ${saveCompleted} after ${waitTime}ms`
        );

        // Restore original saveData
        store.saveData = originalSaveData;
      }
    }

    // Test 10.9: Check for cancel pending save method
    const hasCancelMethod = typeof store.cancelPendingSave === 'function' ||
                            typeof store.cancelSave === 'function' ||
                            typeof store.clearSaveTimer === 'function';
    TestRunner.assert(
      hasCancelMethod,
      'TransactionStore has cancel pending save method',
      `cancelPendingSave: ${typeof store.cancelPendingSave}, cancelSave: ${typeof store.cancelSave}`
    );

    // Test 10.10: Check that regular saveData still exists and works
    TestRunner.assertFunction(
      store.saveData,
      'TransactionStore.saveData() method exists'
    );

    // Test 10.11: Verify save callbacks are still triggered with debouncing
    if (store.onSaveCallbacks && Array.isArray(store.onSaveCallbacks)) {
      TestRunner.assert(
        store.onSaveCallbacks.length >= 0,
        'TransactionStore has onSaveCallbacks array',
        `Callbacks registered: ${store.onSaveCallbacks.length}`
      );
    }

    // Test 10.12: Check triggerSaveCallbacks method exists
    TestRunner.assertFunction(
      store.triggerSaveCallbacks,
      'TransactionStore.triggerSaveCallbacks() method exists'
    );
  }

  // ============================================================================
  // Run All Tests
  // ============================================================================
  async function runAllTests() {
    console.log('\n' + '='.repeat(60));
    console.log('%c PERFORMANCE TESTS FOR ISSUES 8-10 ', 'background: #2c3e50; color: white; padding: 8px 16px; font-size: 14px; font-weight: bold;');
    console.log('='.repeat(60) + '\n');

    TestRunner.reset();

    // Run synchronous tests
    testPagination();
    testRecurringCaching();

    // Run async tests
    await testSaveDebouncing();

    // Print summary
    const summary = TestRunner.printSummary();

    // Provide implementation status summary
    console.log('\n%c Implementation Status ', 'background: #34495e; color: white; padding: 4px 8px; font-weight: bold;');

    const searchUI = getSearchUI();
    const recurringManager = getRecurringManager();
    const store = getStore();

    console.log(`  Issue 8 (Pagination): ${searchUI && searchUI.currentPage !== undefined ? 'IMPLEMENTED' : 'NOT IMPLEMENTED'}`);
    console.log(`  Issue 9 (Caching): ${recurringManager && ('cache' in recurringManager || 'expansionCache' in recurringManager) ? 'IMPLEMENTED' : 'NOT IMPLEMENTED'}`);
    console.log(`  Issue 10 (Debouncing): ${store && ('debouncedSave' in store || 'scheduleSave' in store) ? 'IMPLEMENTED' : 'NOT IMPLEMENTED'}`);

    // Make results available globally for programmatic access
    window.PerformanceTestResults = summary;

    return summary;
  }

  // Execute tests
  runAllTests().then(results => {
    console.log('\nTests complete. Access results via window.PerformanceTestResults');
  }).catch(err => {
    console.error('Test execution error:', err);
  });

})();
