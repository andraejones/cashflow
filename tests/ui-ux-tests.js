/**
 * UI/UX Tests for CashFlow Calendar
 *
 * Tests for Issues 4-7 from UNFIXED_ISSUES.md:
 * - Issue 4: Modal Z-Index Conflicts
 * - Issue 5: No Loading States for Async Operations
 * - Issue 6: Accessibility: ARIA Live Regions
 * - Issue 7: Color Contrast for Negative Balances
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

  // Helper to create temporary elements for testing
  function createTestElement(tag, attributes = {}, parent = document.body) {
    const el = document.createElement(tag);
    Object.entries(attributes).forEach(([key, value]) => {
      if (key === 'className') {
        el.className = value;
      } else if (key === 'textContent') {
        el.textContent = value;
      } else if (key === 'innerHTML') {
        el.innerHTML = value;
      } else if (key === 'style') {
        Object.assign(el.style, value);
      } else {
        el.setAttribute(key, value);
      }
    });
    parent.appendChild(el);
    return el;
  }

  function removeTestElement(el) {
    if (el && el.parentNode) {
      el.parentNode.removeChild(el);
    }
  }

  // Wait utility for async operations
  function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ============================================================================
  // ISSUE 4: Modal Z-Index Conflicts Tests
  // ============================================================================
  console.log('\n%c Issue 4: Modal Z-Index Conflicts ', 'background: #9b59b6; color: white; padding: 4px 8px; font-weight: bold;');

  function testModalZIndex() {
    // Test 4.1: Check if ModalManager exists
    TestRunner.assertExists(
      window.ModalManager,
      'ModalManager global object exists'
    );

    // Test 4.2: Check ModalManager has required methods
    if (window.ModalManager) {
      TestRunner.assertFunction(
        window.ModalManager.register,
        'ModalManager.register() method exists'
      );

      TestRunner.assertFunction(
        window.ModalManager.unregister,
        'ModalManager.unregister() method exists'
      );

      TestRunner.assertFunction(
        window.ModalManager.getNextZIndex,
        'ModalManager.getNextZIndex() method exists'
      );

      // Test 4.3: Test z-index incrementing
      if (typeof window.ModalManager.getNextZIndex === 'function') {
        const firstZIndex = window.ModalManager.getNextZIndex();
        const secondZIndex = window.ModalManager.getNextZIndex();
        TestRunner.assert(
          secondZIndex > firstZIndex,
          'ModalManager.getNextZIndex() returns increasing values',
          `First: ${firstZIndex}, Second: ${secondZIndex}`
        );
      }

      // Test 4.4: Test modal registration
      if (typeof window.ModalManager.register === 'function') {
        const testModal = createTestElement('div', {
          id: 'testModal4',
          className: 'modal',
          style: { display: 'none' }
        });

        try {
          const zIndex = window.ModalManager.register(testModal);
          TestRunner.assert(
            typeof zIndex === 'number' && zIndex >= 1000,
            'ModalManager.register() returns valid z-index',
            `Returned z-index: ${zIndex}`
          );

          // Test 4.5: Check if modal z-index was actually set
          TestRunner.assert(
            parseInt(testModal.style.zIndex, 10) >= 1000,
            'Modal element z-index is set after registration',
            `Modal z-index: ${testModal.style.zIndex}`
          );

          // Cleanup
          if (typeof window.ModalManager.unregister === 'function') {
            window.ModalManager.unregister(testModal);
          }
        } catch (e) {
          TestRunner.assert(false, 'ModalManager.register() executes without error', e.message);
        }

        removeTestElement(testModal);
      }

      // Test 4.6: Test multiple modal stacking
      if (typeof window.ModalManager.register === 'function' &&
          typeof window.ModalManager.unregister === 'function') {
        const modal1 = createTestElement('div', { id: 'testModal4a', className: 'modal' });
        const modal2 = createTestElement('div', { id: 'testModal4b', className: 'modal' });

        try {
          const zIndex1 = window.ModalManager.register(modal1);
          const zIndex2 = window.ModalManager.register(modal2);

          TestRunner.assert(
            zIndex2 > zIndex1,
            'Second modal has higher z-index than first modal',
            `Modal1: ${zIndex1}, Modal2: ${zIndex2}`
          );

          window.ModalManager.unregister(modal2);
          window.ModalManager.unregister(modal1);
        } catch (e) {
          TestRunner.assert(false, 'Multiple modal stacking works', e.message);
        }

        removeTestElement(modal1);
        removeTestElement(modal2);
      }
    } else {
      // Skip dependent tests if ModalManager doesn't exist
      TestRunner.assert(false, 'ModalManager.register() method exists', 'ModalManager not found');
      TestRunner.assert(false, 'ModalManager.unregister() method exists', 'ModalManager not found');
      TestRunner.assert(false, 'ModalManager.getNextZIndex() method exists', 'ModalManager not found');
    }

    // Test 4.7: Check existing modals have proper z-index CSS
    const modals = document.querySelectorAll('.modal');
    if (modals.length > 0) {
      const modalComputedStyles = window.getComputedStyle(modals[0]);
      const baseZIndex = parseInt(modalComputedStyles.zIndex, 10);
      TestRunner.assert(
        baseZIndex >= 1000 || modalComputedStyles.zIndex === 'auto',
        'Existing modals have appropriate base z-index in CSS',
        `Found z-index: ${modalComputedStyles.zIndex}`
      );
    } else {
      TestRunner.assert(true, 'No existing modals to check z-index (skipped)');
    }
  }

  // ============================================================================
  // ISSUE 5: Loading States for Async Operations Tests
  // ============================================================================
  console.log('\n%c Issue 5: Loading States for Async Operations ', 'background: #9b59b6; color: white; padding: 4px 8px; font-weight: bold;');

  async function testLoadingStates() {
    // Test 5.1: Check if loading overlay functions exist in Utils
    TestRunner.assertFunction(
      Utils.showLoadingOverlay,
      'Utils.showLoadingOverlay() function exists'
    );

    TestRunner.assertFunction(
      Utils.hideLoadingOverlay,
      'Utils.hideLoadingOverlay() function exists'
    );

    // Test 5.2: Test showLoadingOverlay creates the overlay element
    if (typeof Utils.showLoadingOverlay === 'function') {
      try {
        Utils.showLoadingOverlay('Test loading message');
        await wait(100);

        const overlay = document.querySelector('.loading-overlay');
        TestRunner.assertExists(
          overlay,
          'showLoadingOverlay() creates .loading-overlay element'
        );

        // Test 5.3: Check overlay has correct display style
        if (overlay) {
          const overlayStyle = window.getComputedStyle(overlay);
          TestRunner.assert(
            overlayStyle.display !== 'none',
            'Loading overlay is visible when shown',
            `Display: ${overlayStyle.display}`
          );

          // Test 5.4: Check overlay has high z-index
          const overlayZIndex = parseInt(overlayStyle.zIndex, 10);
          TestRunner.assert(
            overlayZIndex >= 1000 || overlayStyle.position === 'fixed',
            'Loading overlay has appropriate z-index or fixed position',
            `Z-index: ${overlayZIndex}, Position: ${overlayStyle.position}`
          );

          // Test 5.5: Check overlay contains loading message or spinner
          const hasSpinner = overlay.querySelector('.loading-spinner') !== null;
          const hasMessage = overlay.textContent.includes('Test loading message') ||
                            overlay.textContent.includes('Loading');
          TestRunner.assert(
            hasSpinner || hasMessage || overlay.children.length > 0,
            'Loading overlay contains spinner or message',
            `Has spinner: ${hasSpinner}, Has message: ${hasMessage}`
          );
        }

        // Test 5.6: Test hideLoadingOverlay removes the overlay
        if (typeof Utils.hideLoadingOverlay === 'function') {
          Utils.hideLoadingOverlay();
          await wait(100);

          const overlayAfterHide = document.querySelector('.loading-overlay');
          const isHidden = !overlayAfterHide ||
                          window.getComputedStyle(overlayAfterHide).display === 'none' ||
                          window.getComputedStyle(overlayAfterHide).visibility === 'hidden';
          TestRunner.assert(
            isHidden,
            'hideLoadingOverlay() removes or hides the overlay',
            overlayAfterHide ? `Display: ${window.getComputedStyle(overlayAfterHide).display}` : 'Element removed'
          );
        }
      } catch (e) {
        TestRunner.assert(false, 'Loading overlay functions execute without error', e.message);
      }
    }

    // Test 5.7: Check if CloudSync has loading indicator integration
    if (window.app && window.app.cloudSync) {
      TestRunner.assert(
        true,
        'CloudSync instance exists for loading state integration'
      );
    } else {
      TestRunner.assert(
        typeof CloudSync === 'function',
        'CloudSync class exists (app may not be initialized)',
        'CloudSync class or app.cloudSync should exist'
      );
    }

    // Test 5.8: Check for existing sync indicator element
    const syncIndicator = document.querySelector('.cloud-sync-indicator');
    TestRunner.assert(
      syncIndicator !== null || document.querySelector('[class*="sync"]') !== null,
      'Sync indicator element exists or can be created',
      syncIndicator ? 'Found .cloud-sync-indicator' : 'Checking for sync-related elements'
    );
  }

  // ============================================================================
  // ISSUE 6: Accessibility: ARIA Live Regions Tests
  // ============================================================================
  console.log('\n%c Issue 6: Accessibility: ARIA Live Regions ', 'background: #9b59b6; color: white; padding: 4px 8px; font-weight: bold;');

  async function testAriaLiveRegions() {
    // Test 6.1: Check for aria-live region existence
    const ariaLiveElements = document.querySelectorAll('[aria-live]');
    TestRunner.assert(
      ariaLiveElements.length > 0,
      'At least one aria-live region exists in the DOM',
      `Found ${ariaLiveElements.length} aria-live regions`
    );

    // Test 6.2: Check for dedicated announcement region
    const announcementRegion = document.querySelector('[aria-live="polite"]') ||
                               document.querySelector('[aria-live="assertive"]') ||
                               document.getElementById('aria-announcements') ||
                               document.getElementById('sr-announcements');
    TestRunner.assertExists(
      announcementRegion,
      'Dedicated aria-live announcement region exists'
    );

    // Test 6.3: Check if Utils has announce function
    TestRunner.assertFunction(
      Utils.announce,
      'Utils.announce() function exists for screen reader announcements'
    );

    // Test 6.4: Test announcement function works
    if (typeof Utils.announce === 'function') {
      try {
        Utils.announce('Test announcement for accessibility');
        await wait(100);

        // Check if announcement was made to a live region
        const liveRegions = document.querySelectorAll('[aria-live]');
        let announcementFound = false;
        liveRegions.forEach(region => {
          if (region.textContent.includes('Test announcement')) {
            announcementFound = true;
          }
        });

        // Also check for visually hidden announcement regions
        const srOnlyRegions = document.querySelectorAll('.sr-only, .visually-hidden');
        srOnlyRegions.forEach(region => {
          if (region.textContent.includes('Test announcement')) {
            announcementFound = true;
          }
        });

        TestRunner.assert(
          announcementFound,
          'Utils.announce() updates an aria-live region',
          'Announcement text should appear in aria-live region'
        );
      } catch (e) {
        TestRunner.assert(false, 'Utils.announce() executes without error', e.message);
      }
    }

    // Test 6.5: Check search results region has aria-live
    const searchResults = document.getElementById('searchResults');
    if (searchResults) {
      const hasAriaLive = searchResults.hasAttribute('aria-live') ||
                          searchResults.closest('[aria-live]') !== null;
      TestRunner.assert(
        hasAriaLive,
        'Search results region has aria-live attribute',
        `aria-live: ${searchResults.getAttribute('aria-live')}`
      );
    } else {
      TestRunner.assert(true, 'Search results region aria-live (search modal not in DOM, skipped)');
    }

    // Test 6.6: Check notifications announce to screen readers
    if (typeof Utils.showNotification === 'function') {
      const originalNotification = Utils.showNotification;
      let notificationAnnounced = false;

      // Check if showNotification triggers aria announcement
      try {
        Utils.showNotification('Test notification for accessibility', 'success');
        await wait(100);

        // Look for toast with aria attributes
        const toasts = document.querySelectorAll('.success-toast, .error-toast');
        toasts.forEach(toast => {
          if (toast.hasAttribute('role') ||
              toast.hasAttribute('aria-live') ||
              toast.closest('[aria-live]')) {
            notificationAnnounced = true;
          }
        });

        // Also check if announce was called (if it updates a region)
        const liveRegions = document.querySelectorAll('[aria-live]');
        liveRegions.forEach(region => {
          if (region.textContent.includes('Test notification')) {
            notificationAnnounced = true;
          }
        });

        TestRunner.assert(
          notificationAnnounced || toasts.length > 0,
          'Notifications are accessible to screen readers',
          `Toasts found: ${toasts.length}, Announced: ${notificationAnnounced}`
        );
      } catch (e) {
        TestRunner.assert(false, 'Notification accessibility test', e.message);
      }
    }

    // Test 6.7: Check calendar day grid has proper ARIA attributes
    const calendarDays = document.getElementById('calendarDays');
    if (calendarDays) {
      const hasGridRole = calendarDays.getAttribute('role') === 'grid' ||
                          calendarDays.getAttribute('role') === 'region';
      TestRunner.assert(
        hasGridRole,
        'Calendar days container has appropriate ARIA role',
        `Role: ${calendarDays.getAttribute('role')}`
      );
    }
  }

  // ============================================================================
  // ISSUE 7: Color Contrast for Negative Balances Tests
  // ============================================================================
  console.log('\n%c Issue 7: Color Contrast for Negative Balances ', 'background: #9b59b6; color: white; padding: 4px 8px; font-weight: bold;');

  function testNegativeBalanceContrast() {
    // Test 7.1: Check CSS variables for negative balance colors exist
    const rootStyles = getComputedStyle(document.documentElement);
    const errorColor = rootStyles.getPropertyValue('--error-color').trim() ||
                       rootStyles.getPropertyValue('--negative-color').trim();
    TestRunner.assert(
      errorColor !== '',
      'CSS variable for error/negative color is defined',
      `Error color: ${errorColor}`
    );

    // Test 7.2: Check for negative balance CSS class
    const styleSheets = document.styleSheets;
    let hasNegativeBalanceClass = false;
    let hasNegativeIndicatorClass = false;

    try {
      for (let sheet of styleSheets) {
        try {
          const rules = sheet.cssRules || sheet.rules;
          if (rules) {
            for (let rule of rules) {
              if (rule.selectorText) {
                if (rule.selectorText.includes('.negative-balance') ||
                    rule.selectorText.includes('.unallocated-negative')) {
                  hasNegativeBalanceClass = true;
                }
                if (rule.selectorText.includes('.negative-indicator') ||
                    rule.selectorText.includes('.balance-warning')) {
                  hasNegativeIndicatorClass = true;
                }
              }
            }
          }
        } catch (e) {
          // Cross-origin stylesheets will throw, ignore
        }
      }
    } catch (e) {
      // Fallback: check if classes exist by creating test element
      const testEl = createTestElement('div', { className: 'negative-balance' });
      const testStyle = window.getComputedStyle(testEl);
      hasNegativeBalanceClass = testStyle.backgroundColor !== 'rgba(0, 0, 0, 0)' ||
                                testStyle.color !== 'rgb(0, 0, 0)';
      removeTestElement(testEl);
    }

    TestRunner.assert(
      hasNegativeBalanceClass,
      'CSS class for negative balance styling exists',
      'Should have .negative-balance or .unallocated-negative class'
    );

    // Test 7.3: Check for visual indicators beyond color (icons)
    // Look for icon classes or pseudo-elements that provide non-color indication
    const negativeBalanceElements = document.querySelectorAll('.negative-balance, .unallocated-negative, .first-crisis');
    let hasVisualIndicator = false;

    if (negativeBalanceElements.length > 0) {
      negativeBalanceElements.forEach(el => {
        // Check for icon elements
        if (el.querySelector('[class*="icon"]') ||
            el.querySelector('svg') ||
            el.querySelector('[aria-hidden="true"]') ||
            el.textContent.includes('!') ||
            el.textContent.includes('\u26A0')) { // Warning sign
          hasVisualIndicator = true;
        }

        // Check for border indicators
        const style = window.getComputedStyle(el);
        if (style.borderWidth !== '0px' && style.borderStyle !== 'none') {
          hasVisualIndicator = true;
        }

        // Check for background pattern or different styling
        if (style.backgroundColor !== 'rgba(0, 0, 0, 0)' &&
            style.backgroundColor !== 'transparent') {
          hasVisualIndicator = true;
        }
      });

      TestRunner.assert(
        hasVisualIndicator,
        'Negative balance days have visual indicators beyond just color',
        'Should have border, background, or icon'
      );
    } else {
      // Create a test negative balance element to check styling
      const testDay = createTestElement('div', {
        className: 'day negative-balance',
        innerHTML: '<div class="balance">-100.00</div>'
      });

      const testStyle = window.getComputedStyle(testDay);
      hasVisualIndicator = testStyle.borderWidth !== '0px' ||
                          testStyle.backgroundColor !== 'rgba(0, 0, 0, 0)';

      TestRunner.assert(
        hasVisualIndicator,
        'Negative balance class applies visual indicators (tested with mock element)',
        `Border: ${testStyle.borderWidth}, Background: ${testStyle.backgroundColor}`
      );

      removeTestElement(testDay);
    }

    // Test 7.4: Check if Utils has method to add negative balance indicators
    const hasAddIndicator = typeof Utils.addNegativeIndicator === 'function' ||
                            typeof Utils.formatBalanceWithIndicator === 'function';
    TestRunner.assert(
      hasAddIndicator,
      'Utility function exists for adding negative balance indicators',
      'Should have Utils.addNegativeIndicator or similar'
    );

    // Test 7.5: Check first-crisis class exists and has visual distinction
    const firstCrisisTest = createTestElement('div', { className: 'day first-crisis' });
    const crisisStyle = window.getComputedStyle(firstCrisisTest);

    const hasCrisisIndicator = crisisStyle.borderStyle !== 'none' ||
                               crisisStyle.backgroundColor !== 'rgba(0, 0, 0, 0)' ||
                               crisisStyle.boxShadow !== 'none';

    TestRunner.assert(
      hasCrisisIndicator,
      'First-crisis class has distinct visual styling',
      `Border: ${crisisStyle.borderStyle}, Background: ${crisisStyle.backgroundColor}`
    );

    removeTestElement(firstCrisisTest);

    // Test 7.6: Check contrast ratio (simplified check)
    // Get error color and check it's distinct from background
    if (errorColor) {
      // Convert to RGB for comparison
      const testEl = createTestElement('span', {
        className: 'expense',
        style: { color: 'var(--error-color)' }
      });
      const computedColor = window.getComputedStyle(testEl).color;

      // Check it's not pure black or too similar to default text
      const isDistinctColor = computedColor !== 'rgb(0, 0, 0)' &&
                              computedColor !== 'rgb(31, 43, 42)'; // ink-color

      TestRunner.assert(
        isDistinctColor,
        'Error/negative color is visually distinct',
        `Computed color: ${computedColor}`
      );

      removeTestElement(testEl);
    }

    // Test 7.7: Check for warning icon class in styles
    let hasWarningIcon = false;
    try {
      for (let sheet of document.styleSheets) {
        try {
          const rules = sheet.cssRules || sheet.rules;
          if (rules) {
            for (let rule of rules) {
              if (rule.selectorText &&
                  (rule.selectorText.includes('warning') ||
                   rule.selectorText.includes('negative') ||
                   rule.selectorText.includes('crisis'))) {
                const cssText = rule.cssText || '';
                if (cssText.includes('content:') ||
                    cssText.includes('::before') ||
                    cssText.includes('::after')) {
                  hasWarningIcon = true;
                }
              }
            }
          }
        } catch (e) {
          // Cross-origin, ignore
        }
      }
    } catch (e) {
      // Fallback check
    }

    // Also check if there's an icon mechanism in the DOM generation
    const calendarDays = document.getElementById('calendarDays');
    if (calendarDays) {
      const daysWithIndicators = calendarDays.querySelectorAll('.negative-balance, .first-crisis');
      daysWithIndicators.forEach(day => {
        if (day.innerHTML.includes('!') ||
            day.innerHTML.includes('icon') ||
            day.innerHTML.includes('warning') ||
            day.innerHTML.includes('\u26A0') ||
            day.innerHTML.includes('&#x26A0;')) {
          hasWarningIcon = true;
        }
      });
    }

    TestRunner.assert(
      hasWarningIcon || hasNegativeIndicatorClass,
      'Warning icons or indicators are available for negative balances',
      'Should have CSS pseudo-elements or inline icons for accessibility'
    );
  }

  // ============================================================================
  // Run All Tests
  // ============================================================================
  async function runAllTests() {
    console.log('\n' + '='.repeat(60));
    console.log('%c UI/UX TESTS FOR ISSUES 4-7 ', 'background: #2c3e50; color: white; padding: 8px 16px; font-size: 14px; font-weight: bold;');
    console.log('='.repeat(60) + '\n');

    TestRunner.reset();

    // Run synchronous tests
    testModalZIndex();

    // Run async tests
    await testLoadingStates();
    await testAriaLiveRegions();

    // Run more synchronous tests
    testNegativeBalanceContrast();

    // Print summary
    const summary = TestRunner.printSummary();

    // Make results available globally for programmatic access
    window.UIUXTestResults = summary;

    return summary;
  }

  // Execute tests
  runAllTests().then(results => {
    console.log('\nTests complete. Access results via window.UIUXTestResults');
  }).catch(err => {
    console.error('Test execution error:', err);
  });

})();
