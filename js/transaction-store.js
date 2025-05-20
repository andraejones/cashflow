/**
 * TransactionStore class - Manages all transactions and balances
 */
class TransactionStore {
  /**
   * Create a new TransactionStore
   * @param {Object} storage - Storage object with getItem, setItem, etc. (defaults to localStorage)
   */
  constructor(storage = localStorage) {
    this.storage = storage;
    this.transactions = {};
    this.monthlyBalances = {};
    this.recurringTransactions = [];
    this.skippedTransactions = {};
    this.onSaveCallbacks = [];

    this.loadData();
  }

  /**
   * Register a callback to be called after data is saved
   * @param {Function} callback - Callback function
   */
  registerSaveCallback(callback) {
    if (typeof callback === 'function') {
      this.onSaveCallbacks.push(callback);
    }
  }

  /**
   * Trigger all registered save callbacks
   */
  triggerSaveCallbacks(isDataModified = false) {
    this.onSaveCallbacks.forEach(callback => {
      try {
        callback(isDataModified);
      } catch (error) {
        console.error("Error in save callback:", error);
      }
    });
  }

  /**
   * Load data from storage
   */
  loadData() {
    try {
      const storedTransactions = this.storage.getItem("transactions");
      const storedMonthlyBalances = this.storage.getItem("monthlyBalances");
      const storedRecurringTransactions = this.storage.getItem(
        "recurringTransactions"
      );
      const storedSkippedTransactions = this.storage.getItem(
        "skippedTransactions"
      );

      if (storedTransactions) {
        this.transactions = JSON.parse(storedTransactions);
      }

      if (storedMonthlyBalances) {
        this.monthlyBalances = JSON.parse(storedMonthlyBalances);
      }

      if (storedRecurringTransactions) {
        this.recurringTransactions = JSON.parse(storedRecurringTransactions);

        // Ensure all recurring transactions have an ID (for backward compatibility)
        this.recurringTransactions.forEach((rt) => {
          if (!rt.id) {
            rt.id = Utils.generateUniqueId();
          }
          
          // Migrate legacy recurrence types for backward compatibility
          if (rt.recurrence === "biweekly") {
            rt.recurrence = "bi-weekly";
          } else if (rt.recurrence === "semimonthly") {
            rt.recurrence = "semi-monthly";
          } else if (rt.recurrence === "semiannual") {
            rt.recurrence = "semi-annual";
          }
        });
      }

      if (storedSkippedTransactions) {
        this.skippedTransactions = JSON.parse(storedSkippedTransactions);
      }
    } catch (error) {
      console.error("Error loading data from storage:", error);
      // Initialize with empty values on error
      this.transactions = {};
      this.monthlyBalances = {};
      this.recurringTransactions = [];
      this.skippedTransactions = {};
    }
  }

  /**
   * Save data to storage
   * @param {boolean} isDataModified - Whether the data was modified by a user action (default: true)
   */
  saveData(isDataModified = true) {
    try {
      this.storage.setItem("transactions", JSON.stringify(this.transactions));
      this.storage.setItem(
        "monthlyBalances",
        JSON.stringify(this.monthlyBalances)
      );
      this.storage.setItem(
        "recurringTransactions",
        JSON.stringify(this.recurringTransactions)
      );
      this.storage.setItem(
        "skippedTransactions",
        JSON.stringify(this.skippedTransactions)
      );
      
      // Trigger callbacks with the isDataModified flag
      // This helps callbacks distinguish between UI refreshes and actual data changes
      this.triggerSaveCallbacks(isDataModified);
    } catch (error) {
      console.error("Error saving data to storage:", error);
    }
  }

  /**
   * Reset all data. This method always clears stored data.
   * @returns {boolean} Always returns true
   */
  resetData() {
    // Clear in-memory data
    this.transactions = {};
    this.monthlyBalances = {};
    this.recurringTransactions = [];
    this.skippedTransactions = {};

    // Save the empty objects
    this.saveData();
    return true;
  }

  /**
   * Get all transactions
   * @returns {Object} Transactions object
   */
  getTransactions() {
    return this.transactions;
  }

  /**
   * Get monthly balances
   * @returns {Object} Monthly balances object
   */
  getMonthlyBalances() {
    return this.monthlyBalances;
  }

  /**
   * Get recurring transactions
   * @returns {Array} Array of recurring transactions
   */
  getRecurringTransactions() {
    return this.recurringTransactions;
  }

  /**
   * Get skipped transactions
   * @returns {Object} Skipped transactions by date
   */
  getSkippedTransactions() {
    return this.skippedTransactions;
  }

  /**
   * Add a transaction
   * @param {string} date - Date string in YYYY-MM-DD format
   * @param {Object} transaction - Transaction object
   */
  addTransaction(date, transaction) {
    if (!date || !transaction) {
      console.error("Invalid date or transaction data");
      return;
    }

    if (!this.transactions[date]) {
      this.transactions[date] = [];
    }

    this.transactions[date].push(transaction);
    this.saveData();
  }

  /**
   * Update a transaction
   * @param {string} date - Date string in YYYY-MM-DD format
   * @param {number} index - Index of transaction to update
   * @param {Object} updatedTransaction - New transaction data
   */
  updateTransaction(date, index, updatedTransaction) {
    if (!date || index === undefined || !updatedTransaction) {
      console.error("Invalid parameters for updateTransaction");
      return;
    }

    if (this.transactions[date] && this.transactions[date][index]) {
      this.transactions[date][index] = {
        ...this.transactions[date][index],
        ...updatedTransaction,
      };
      this.saveData();
    }
  }

  /**
   * Delete a transaction
   * @param {string} date - Date string in YYYY-MM-DD format
   * @param {number} index - Index of transaction to delete
   */
  deleteTransaction(date, index) {
    if (!date || index === undefined) {
      console.error("Invalid parameters for deleteTransaction");
      return;
    }

    if (this.transactions[date] && this.transactions[date][index]) {
      this.transactions[date].splice(index, 1);

      if (this.transactions[date].length === 0) {
        delete this.transactions[date];
      }

      this.saveData();
    }
  }

  /**
   * Add a recurring transaction
   * @param {Object} recurringTransaction - The recurring transaction object
   * @returns {string} ID of the added recurring transaction
   */
  addRecurringTransaction(recurringTransaction) {
    if (!recurringTransaction) {
      console.error("Invalid recurring transaction data");
      return null;
    }

    // Ensure it has an ID
    if (!recurringTransaction.id) {
      recurringTransaction.id = Utils.generateUniqueId();
    }

    this.recurringTransactions.push(recurringTransaction);
    this.saveData();

    return recurringTransaction.id;
  }

  /**
   * Update a recurring transaction
   * @param {string} id - ID of recurring transaction to update
   * @param {Object} updates - Properties to update
   * @returns {boolean} True if update was successful
   */
  updateRecurringTransaction(id, updates) {
    if (!id || !updates) {
      console.error("Invalid parameters for updateRecurringTransaction");
      return false;
    }

    const index = this.recurringTransactions.findIndex((rt) => rt.id === id);

    if (index !== -1) {
      this.recurringTransactions[index] = {
        ...this.recurringTransactions[index],
        ...updates,
      };
      this.saveData();
      return true;
    }

    return false;
  }

  /**
   * Delete a recurring transaction
   * @param {string} id - ID of the recurring transaction to delete
   * @returns {boolean} True if deletion was successful
   */
  deleteRecurringTransaction(id) {
    if (!id) {
      console.error("Invalid ID for deleteRecurringTransaction");
      return false;
    }
    
    const index = this.recurringTransactions.findIndex(rt => rt.id === id);
    
    if (index === -1) {
      return false;
    }
    
    // Remove the recurring transaction
    this.recurringTransactions.splice(index, 1);
    
    // Remove all instances of this recurring transaction
    for (const dateKey in this.transactions) {
      this.transactions[dateKey] = this.transactions[dateKey].filter(
        t => !t.recurringId || t.recurringId !== id
      );
      
      if (this.transactions[dateKey].length === 0) {
        delete this.transactions[dateKey];
      }
    }
    
    // Clean up any skipped instances
    for (const dateKey in this.skippedTransactions) {
      const skipIndex = this.skippedTransactions[dateKey].indexOf(id);
      if (skipIndex > -1) {
        this.skippedTransactions[dateKey].splice(skipIndex, 1);
        
        if (this.skippedTransactions[dateKey].length === 0) {
          delete this.skippedTransactions[dateKey];
        }
      }
    }
    
    this.saveData();
    return true;
  }

  /**
   * Set a transaction as skipped
   * @param {string} date - Date string in YYYY-MM-DD format
   * @param {string} recurringId - ID of recurring transaction
   * @param {boolean} isSkipped - Whether to skip the transaction
   * @returns {boolean} True if operation was successful
   */
  setTransactionSkipped(date, recurringId, isSkipped) {
    if (!date || !recurringId) {
      console.error("Invalid parameters for setTransactionSkipped");
      return false;
    }

    try {
      if (isSkipped) {
        if (!this.skippedTransactions[date]) {
          this.skippedTransactions[date] = [];
        }

        if (!this.skippedTransactions[date].includes(recurringId)) {
          this.skippedTransactions[date].push(recurringId);
        }
      } else {
        if (this.skippedTransactions[date]) {
          const index = this.skippedTransactions[date].indexOf(recurringId);

          if (index > -1) {
            this.skippedTransactions[date].splice(index, 1);

            if (this.skippedTransactions[date].length === 0) {
              delete this.skippedTransactions[date];
            }
          }
        }
      }

      this.saveData();
      return true;
    } catch (error) {
      console.error("Error in setTransactionSkipped:", error);
      return false;
    }
  }

  /**
   * Check if a transaction is skipped
   * @param {string} date - Date string in YYYY-MM-DD format
   * @param {string} recurringId - ID of recurring transaction
   * @returns {boolean} True if transaction is skipped
   */
  isTransactionSkipped(date, recurringId) {
    if (!date || !recurringId) {
      return false;
    }

    return (
      this.skippedTransactions[date] &&
      this.skippedTransactions[date].includes(recurringId)
    );
  }

  /**
   * Export all data as a JSON object
   * @returns {Object} All application data
   */
  exportData() {
    return {
      transactions: this.transactions,
      monthlyBalances: this.monthlyBalances,
      recurringTransactions: this.recurringTransactions,
      skippedTransactions: this.skippedTransactions,
      lastExported: new Date().toISOString(),
      appVersion: "2.0.0"  // Add version for compatibility checking
    };
  }

  /**
   * Import data from a JSON object
   * @param {Object} data - Data to import
   * @returns {boolean} True if import was successful
   */
  importData(data) {
    if (!data || typeof data !== 'object') {
      console.error("Invalid data format for import");
      return false;
    }
    
    if (
      !data.transactions ||
      !data.monthlyBalances ||
      !data.recurringTransactions
    ) {
      console.error("Missing required data properties for import");
      return false;
    }

    try {
      this.transactions = data.transactions;
      this.monthlyBalances = data.monthlyBalances;
      this.recurringTransactions = data.recurringTransactions;
      this.skippedTransactions = data.skippedTransactions || {};

      // Ensure all recurring transactions have IDs
      this.recurringTransactions.forEach((rt) => {
        if (!rt.id) {
          rt.id = Utils.generateUniqueId();
        }
        
        // Migrate legacy recurrence types
        if (rt.recurrence === "biweekly") {
          rt.recurrence = "bi-weekly";
        } else if (rt.recurrence === "semimonthly") {
          rt.recurrence = "semi-monthly";
        } else if (rt.recurrence === "semiannual") {
          rt.recurrence = "semi-annual";
        }
      });

      // Convert legacy transactions
      Object.keys(this.transactions).forEach((date) => {
        this.transactions[date].forEach((t, index) => {
          if (t.isRecurring) {
            // Find matching recurring transaction
            const matchingRt = this.recurringTransactions.find(
              (rt) =>
                rt.amount === (t.originalAmount || t.amount) &&
                rt.type === (t.originalType || t.type) &&
                rt.description === (t.originalDescription || t.description) &&
                new Date(rt.startDate) <= new Date(date)
            );

            if (matchingRt) {
              this.transactions[date][index] = {
                amount: t.amount,
                type: t.type,
                description: t.description,
                recurringId: matchingRt.id,
                modifiedInstance: t.modifiedRecurring || false,
              };

              // Handle skipped flag from old system
              if (t.skipped) {
                this.setTransactionSkipped(date, matchingRt.id, true);
              }
            }
          }
        });
      });

      this.saveData();
      return true;
    } catch (error) {
      console.error("Error during import:", error);
      return false;
    }
  }
}
