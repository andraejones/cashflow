// Transaction storage

class TransactionStore {

  constructor(storage = localStorage, pinProtection = null) {
    this.storage = storage;
    this.pinProtection = pinProtection;
    this.transactions = {};
    this.monthlyBalances = {};
    this.recurringTransactions = [];
    this.skippedTransactions = {};
    this.onSaveCallbacks = [];

    this.loadData();
  }

  
  registerSaveCallback(callback) {
    if (typeof callback === 'function') {
      this.onSaveCallbacks.push(callback);
    }
  }

  
  triggerSaveCallbacks(isDataModified = false) {
    this.onSaveCallbacks.forEach(callback => {
      try {
        callback(isDataModified);
      } catch (error) {
        console.error("Error in save callback:", error);
      }
    });
  }

  
  loadData() {
    try {
      const decrypt = (val) => {
        if (
          this.pinProtection &&
          this.pinProtection.getCurrentPin() &&
          val
        ) {
          return this.pinProtection.decrypt(val);
        }
        return val;
      };

      const storedTransactions = decrypt(this.storage.getItem("transactions"));
      const storedMonthlyBalances = decrypt(this.storage.getItem("monthlyBalances"));
      const storedRecurringTransactions = decrypt(
        this.storage.getItem("recurringTransactions")
      );
      const storedSkippedTransactions = decrypt(
        this.storage.getItem("skippedTransactions")
      );

      if (storedTransactions) {
        this.transactions = JSON.parse(storedTransactions);
      }

      if (storedMonthlyBalances) {
        this.monthlyBalances = JSON.parse(storedMonthlyBalances);
      }

      if (storedRecurringTransactions) {
        this.recurringTransactions = JSON.parse(storedRecurringTransactions);
        this.recurringTransactions.forEach((rt) => {
          if (!rt.id) {
            rt.id = Utils.generateUniqueId();
          }
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
      this.transactions = {};
      this.monthlyBalances = {};
      this.recurringTransactions = [];
      this.skippedTransactions = {};
    }
  }

  
  saveData(isDataModified = true) {
    try {
      const encrypt = (val) => {
        if (
          this.pinProtection &&
          this.pinProtection.getCurrentPin()
        ) {
          return this.pinProtection.encrypt(val);
        }
        return val;
      };

      this.storage.setItem(
        "transactions",
        encrypt(JSON.stringify(this.transactions))
      );
      this.storage.setItem(
        "monthlyBalances",
        encrypt(JSON.stringify(this.monthlyBalances))
      );
      this.storage.setItem(
        "recurringTransactions",
        encrypt(JSON.stringify(this.recurringTransactions))
      );
      this.storage.setItem(
        "skippedTransactions",
        encrypt(JSON.stringify(this.skippedTransactions))
      );
      this.triggerSaveCallbacks(isDataModified);
    } catch (error) {
      console.error("Error saving data to storage:", error);
    }
  }

  
  resetData() {
    this.transactions = {};
    this.monthlyBalances = {};
    this.recurringTransactions = [];
    this.skippedTransactions = {};
    this.saveData();
    return true;
  }

  
  getTransactions() {
    return this.transactions;
  }

  
  getMonthlyBalances() {
    return this.monthlyBalances;
  }

  
  getRecurringTransactions() {
    return this.recurringTransactions;
  }

  
  getSkippedTransactions() {
    return this.skippedTransactions;
  }

  
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

  
  addRecurringTransaction(recurringTransaction) {
    if (!recurringTransaction) {
      console.error("Invalid recurring transaction data");
      return null;
    }
    if (!recurringTransaction.id) {
      recurringTransaction.id = Utils.generateUniqueId();
    }

    this.recurringTransactions.push(recurringTransaction);
    this.saveData();

    return recurringTransaction.id;
  }

  
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

  
  deleteRecurringTransaction(id) {
    if (!id) {
      console.error("Invalid ID for deleteRecurringTransaction");
      return false;
    }
    
    const index = this.recurringTransactions.findIndex(rt => rt.id === id);
    
    if (index === -1) {
      return false;
    }
    this.recurringTransactions.splice(index, 1);
    for (const dateKey in this.transactions) {
      this.transactions[dateKey] = this.transactions[dateKey].filter(
        t => !t.recurringId || t.recurringId !== id
      );
      
      if (this.transactions[dateKey].length === 0) {
        delete this.transactions[dateKey];
      }
    }
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

  
  isTransactionSkipped(date, recurringId) {
    if (!date || !recurringId) {
      return false;
    }

    return (
      this.skippedTransactions[date] &&
      this.skippedTransactions[date].includes(recurringId)
    );
  }

  
  exportData() {
    return {
      transactions: this.transactions,
      monthlyBalances: this.monthlyBalances,
      recurringTransactions: this.recurringTransactions,
      skippedTransactions: this.skippedTransactions,
      lastExported: new Date().toISOString(),
      appVersion: "2.0.0"
    };
  }

  
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
      this.recurringTransactions.forEach((rt) => {
        if (!rt.id) {
          rt.id = Utils.generateUniqueId();
        }
        if (rt.recurrence === "biweekly") {
          rt.recurrence = "bi-weekly";
        } else if (rt.recurrence === "semimonthly") {
          rt.recurrence = "semi-monthly";
        } else if (rt.recurrence === "semiannual") {
          rt.recurrence = "semi-annual";
        }
      });
      Object.keys(this.transactions).forEach((date) => {
        this.transactions[date].forEach((t, index) => {
          if (t.isRecurring) {
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
