// Transaction storage

class TransactionStore {

  constructor(storage = localStorage, pinProtection = null) {
    this.storage = storage;
    this.pinProtection = pinProtection;
    this.transactions = {};
    this.monthlyBalances = {};
    this.recurringTransactions = [];
    this.skippedTransactions = {};
    this.debts = [];
    this.cashInfusions = [];
    this.monthlyNotes = {};
    this.debtSnowballSettings = {
      extraPayment: 0,
      autoGenerate: false,
    };
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
      const storedDebts = decrypt(this.storage.getItem("debts"));
      const storedCashInfusions = decrypt(
        this.storage.getItem("cashInfusions")
      );
      const storedSnowballSettings = decrypt(
        this.storage.getItem("debtSnowballSettings")
      );
      const storedMonthlyNotes = decrypt(
        this.storage.getItem("monthlyNotes")
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

      if (storedDebts) {
        const parsedDebts = JSON.parse(storedDebts);
        this.debts = parsedDebts.map((debt) => ({
          ...debt,
          id: debt.id || Utils.generateUniqueId(),
          balance: Number(debt.balance) || 0,
          minPayment: Number(debt.minPayment) || 0,
          dueDay: Number(debt.dueDay) || 1,
          dueDayPattern:
            typeof debt.dueDayPattern === "string" ? debt.dueDayPattern : "",
          recurrence:
            typeof debt.recurrence === "string" ? debt.recurrence : "monthly",
          dueStartDate:
            typeof debt.dueStartDate === "string" ? debt.dueStartDate : "",
          businessDayAdjustment:
            typeof debt.businessDayAdjustment === "string"
              ? debt.businessDayAdjustment
              : "none",
          semiMonthlyDays: Array.isArray(debt.semiMonthlyDays)
            ? debt.semiMonthlyDays.map((day) => Number(day) || 1)
            : null,
          semiMonthlyLastDay: debt.semiMonthlyLastDay === true,
          customInterval:
            debt.customInterval && typeof debt.customInterval === "object"
              ? {
                value: Number(debt.customInterval.value) || 1,
                unit:
                  debt.customInterval.unit === "weeks" ||
                    debt.customInterval.unit === "months"
                    ? debt.customInterval.unit
                    : "days",
              }
              : null,
          variableAmount: debt.variableAmount === true,
          variableType:
            debt.variableType === "percentage" ? "percentage" : "percentage",
          variablePercentage: Number(debt.variablePercentage) || 0,
          endDate: typeof debt.endDate === "string" ? debt.endDate : "",
          maxOccurrences: Number(debt.maxOccurrences) || null,
          interestRate: Number(debt.interestRate) || 0,
        }));
      }

      if (storedCashInfusions) {
        const parsedInfusions = JSON.parse(storedCashInfusions);
        this.cashInfusions = parsedInfusions.map((infusion) => ({
          ...infusion,
          id: infusion.id || Utils.generateUniqueId(),
          name: typeof infusion.name === "string" ? infusion.name : "",
          amount: Number(infusion.amount) || 0,
          date: typeof infusion.date === "string" ? infusion.date : "",
          targetDebtId: infusion.targetDebtId || null,
        }));
      }

      if (storedSnowballSettings) {
        const parsedSettings = JSON.parse(storedSnowballSettings);
        this.debtSnowballSettings = {
          extraPayment: Number(parsedSettings.extraPayment) || 0,
          autoGenerate: parsedSettings.autoGenerate === true,
        };
      }

      if (storedMonthlyNotes) {
        this.monthlyNotes = JSON.parse(storedMonthlyNotes);
      }
      if (this.debts.length > 0 && this.recurringTransactions.length > 0) {
        const recurringIds = new Set(
          this.recurringTransactions.map((rt) => rt.id)
        );
        this.debts.forEach((debt) => {
          if (debt.minRecurringId && !recurringIds.has(debt.minRecurringId)) {
            debt.minRecurringId = null;
          }
        });
      }
    } catch (error) {
      console.error("Error loading data from storage:", error);
      this.transactions = {};
      this.monthlyBalances = {};
      this.recurringTransactions = [];
      this.skippedTransactions = {};
      this.debts = [];
      this.cashInfusions = [];
      this.debtSnowballSettings = {
        extraPayment: 0,
        autoGenerate: false,
      };
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
      this.storage.setItem("debts", encrypt(JSON.stringify(this.debts)));
      this.storage.setItem(
        "cashInfusions",
        encrypt(JSON.stringify(this.cashInfusions))
      );
      this.storage.setItem(
        "debtSnowballSettings",
        encrypt(JSON.stringify(this.debtSnowballSettings))
      );
      this.storage.setItem(
        "monthlyNotes",
        encrypt(JSON.stringify(this.monthlyNotes))
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
    this.debts = [];
    this.cashInfusions = [];
    this.monthlyNotes = {};
    this.debtSnowballSettings = {
      extraPayment: 0,
      autoGenerate: false,
    };
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


  getDebts() {
    return this.debts;
  }


  getDebtSnowballSettings() {
    return this.debtSnowballSettings;
  }


  getCashInfusions() {
    return this.cashInfusions;
  }


  addCashInfusion(infusion) {
    if (!infusion) {
      console.error("Invalid cash infusion data");
      return null;
    }
    if (!infusion.id) {
      infusion.id = Utils.generateUniqueId();
    }
    this.cashInfusions.push(infusion);
    this.saveData();
    return infusion.id;
  }


  updateCashInfusion(id, updates) {
    if (!id || !updates) {
      console.error("Invalid parameters for updateCashInfusion");
      return false;
    }
    const index = this.cashInfusions.findIndex((inf) => inf.id === id);
    if (index === -1) {
      return false;
    }
    this.cashInfusions[index] = {
      ...this.cashInfusions[index],
      ...updates,
    };
    this.saveData();
    return true;
  }


  deleteCashInfusion(id) {
    if (!id) {
      console.error("Invalid ID for deleteCashInfusion");
      return false;
    }
    const index = this.cashInfusions.findIndex((inf) => inf.id === id);
    if (index === -1) {
      return false;
    }
    this.cashInfusions.splice(index, 1);
    this.saveData();
    return true;
  }


  getMonthlyNotes(monthKey) {
    return this.monthlyNotes[monthKey] || "";
  }

  setMonthlyNotes(monthKey, notes) {
    if (!monthKey) {
      console.error("Invalid monthKey for setMonthlyNotes");
      return false;
    }
    if (notes && notes.trim()) {
      this.monthlyNotes[monthKey] = notes.trim();
    } else {
      // Remove empty notes
      delete this.monthlyNotes[monthKey];
    }
    this.saveData();
    return true;
  }

  hasMonthlyNotes(monthKey) {
    return !!(this.monthlyNotes[monthKey] && this.monthlyNotes[monthKey].trim());
  }


  addDebt(debt) {
    if (!debt) {
      console.error("Invalid debt data");
      return null;
    }
    if (!debt.id) {
      debt.id = Utils.generateUniqueId();
    }
    this.debts.push(debt);
    this.saveData();
    return debt.id;
  }


  updateDebt(id, updates) {
    if (!id || !updates) {
      console.error("Invalid parameters for updateDebt");
      return false;
    }
    const index = this.debts.findIndex((debt) => debt.id === id);
    if (index === -1) {
      return false;
    }
    this.debts[index] = {
      ...this.debts[index],
      ...updates,
    };
    this.saveData();
    return true;
  }


  deleteDebt(id) {
    if (!id) {
      console.error("Invalid ID for deleteDebt");
      return false;
    }
    const index = this.debts.findIndex((debt) => debt.id === id);
    if (index === -1) {
      return false;
    }
    this.debts.splice(index, 1);
    this.saveData();
    return true;
  }


  setDebtSnowballSettings(settings) {
    if (!settings || typeof settings !== "object") {
      console.error("Invalid settings for debt snowball");
      return false;
    }
    this.debtSnowballSettings = {
      ...this.debtSnowballSettings,
      extraPayment: Number(settings.extraPayment) || 0,
      autoGenerate: settings.autoGenerate === true,
    };
    this.saveData();
    return true;
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


  setTransactionSkipped(date, recurringId, isSkipped, isDataModified = true) {
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

      this.saveData(isDataModified);
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
      debts: this.debts,
      cashInfusions: this.cashInfusions,
      monthlyNotes: this.monthlyNotes,
      debtSnowballSettings: this.debtSnowballSettings,
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
      this.debts = (data.debts || []).map((debt) => ({
        ...debt,
        id: debt.id || Utils.generateUniqueId(),
        balance: Number(debt.balance) || 0,
        minPayment: Number(debt.minPayment) || 0,
        dueDay: Number(debt.dueDay) || 1,
        dueDayPattern:
          typeof debt.dueDayPattern === "string" ? debt.dueDayPattern : "",
        recurrence:
          typeof debt.recurrence === "string" ? debt.recurrence : "monthly",
        dueStartDate:
          typeof debt.dueStartDate === "string" ? debt.dueStartDate : "",
        businessDayAdjustment:
          typeof debt.businessDayAdjustment === "string"
            ? debt.businessDayAdjustment
            : "none",
        semiMonthlyDays: Array.isArray(debt.semiMonthlyDays)
          ? debt.semiMonthlyDays.map((day) => Number(day) || 1)
          : null,
        semiMonthlyLastDay: debt.semiMonthlyLastDay === true,
        customInterval:
          debt.customInterval && typeof debt.customInterval === "object"
            ? {
              value: Number(debt.customInterval.value) || 1,
              unit:
                debt.customInterval.unit === "weeks" ||
                  debt.customInterval.unit === "months"
                  ? debt.customInterval.unit
                  : "days",
            }
            : null,
        variableAmount: debt.variableAmount === true,
        variableType:
          debt.variableType === "percentage" ? "percentage" : "percentage",
        variablePercentage: Number(debt.variablePercentage) || 0,
        endDate: typeof debt.endDate === "string" ? debt.endDate : "",
        maxOccurrences: Number(debt.maxOccurrences) || null,
        interestRate: Number(debt.interestRate) || 0,
      }));
      this.cashInfusions = (data.cashInfusions || []).map((infusion) => ({
        ...infusion,
        id: infusion.id || Utils.generateUniqueId(),
        name: typeof infusion.name === "string" ? infusion.name : "",
        amount: Number(infusion.amount) || 0,
        date: typeof infusion.date === "string" ? infusion.date : "",
        targetDebtId: infusion.targetDebtId || null,
      }));
      this.debtSnowballSettings = {
        extraPayment: Number(data.debtSnowballSettings?.extraPayment) || 0,
        autoGenerate: data.debtSnowballSettings?.autoGenerate === true,
      };
      this.monthlyNotes = data.monthlyNotes || {};
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
      const recurringIds = new Set(
        this.recurringTransactions.map((rt) => rt.id)
      );
      this.debts.forEach((debt) => {
        if (debt.minRecurringId && !recurringIds.has(debt.minRecurringId)) {
          debt.minRecurringId = null;
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
                this.setTransactionSkipped(date, matchingRt.id, true, false);
              }
            }
          }
        });
      });

      this.saveData(false);
      return true;
    } catch (error) {
      console.error("Error during import:", error);
      return false;
    }
  }
}
