// Application entry point

class CashflowApp {

  constructor(pinProtection) {
    this.pinProtection = pinProtection;
    this.store = new TransactionStore(undefined, this.pinProtection);
    this.recurringManager = new RecurringTransactionManager(this.store);
    this.calculationService = new CalculationService(
      this.store,
      this.recurringManager
    );
    this.cloudSync = new CloudSync(this.store, () => this.updateUI());
    this.transactionUI = new TransactionUI(
      this.store,
      this.recurringManager,
      () => {
        this.updateUI();
      },
      this.cloudSync
    );

    this.calendarUI = new CalendarUI(
      this.store,
      this.recurringManager,
      this.calculationService,
      this.transactionUI
    );

    this.searchUI = new SearchUI(
      this.store,
      this.recurringManager,
      this.transactionUI
    );
    this.init();
  }

  
  async init() {
    try {
      this.cleanUpHtmlArtifacts();
      await this.cloudSync.loadFromCloud();
    } catch (error) {
      console.error("Error loading from cloud:", error);
    }
    this.updateUI();
    window.addTransaction = () => this.transactionUI.addTransaction();
  }

  
  cleanUpHtmlArtifacts() {
    const bodyChildren = document.body.childNodes;
    for (let i = bodyChildren.length - 1; i >= 0; i--) {
      const node = bodyChildren[i];
      if (node.nodeType === Node.TEXT_NODE && 
          (node.textContent.includes("<div") || 
           node.textContent.includes("modal-content"))) {
        document.body.removeChild(node);
      }
    }
  }

  
  updateUI() {
    this.calendarUI.generateCalendar();
  }

  
  exportData() {
    try {
      this.cloudSync.cancelPendingCloudSave();

      const data = this.store.exportData();

      const now = new Date();
      const day = String(now.getDate()).padStart(2, "0");
      const month = String(now.getMonth() + 1).padStart(2, "0");
      const year = String(now.getFullYear()).slice(-2);
      const hours = String(now.getHours()).padStart(2, "0");
      const minutes = String(now.getMinutes()).padStart(2, "0");

      const filename = `cashflow_data_${day}-${month}-${year}_${hours}${minutes}.json`;

      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      Utils.showNotification("Data exported successfully!");
    } catch (error) {
      console.error("Error exporting data:", error);
      Utils.showNotification("Failed to export data: " + error.message, "error");
    }
  }

  
  importData() {
    try {
      this.cloudSync.cancelPendingCloudSave();

      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".json";

      input.onchange = (e) => {
        if (!e.target.files || e.target.files.length === 0) {
          Utils.showNotification("No file selected", "error");
          return;
        }
        
        const file = e.target.files[0];
        const reader = new FileReader();

        reader.onload = (readerEvent) => {
          try {
            if (!readerEvent.target.result) {
              throw new Error("Could not read file");
            }
            
            const content = JSON.parse(readerEvent.target.result);

            const success = this.store.importData(content);

            if (success) {
              this.calculationService.invalidateCache();
              this.updateUI();
              
              Utils.showNotification("Data imported successfully!");
            } else {
              throw new Error("Invalid file format");
            }
          } catch (error) {
            console.error("Error parsing imported data:", error);
            Utils.showNotification(
              "Error importing data: " + error.message,
              "error"
            );
          }
        };

        reader.onerror = () => {
          Utils.showNotification("Failed to read file", "error");
        };

        reader.readAsText(file);
      };

      input.click();
    } catch (error) {
      console.error("Error in import process:", error);
      Utils.showNotification("Error importing data: " + error.message, "error");
    }
  }

  
  resetData() {
    try {
      this.cloudSync.cancelPendingCloudSave();

      if (
        confirm(
          "Are you sure you want to reset all data? This will also clear your cloud sync credentials."
        )
      ) {
        this.store.resetData();
        this.cloudSync.clearCloudCredentials();
        this.calculationService.invalidateCache();
        this.updateUI();
        
        Utils.showNotification("All data has been reset.");
      }
    } catch (error) {
      console.error("Error resetting data:", error);
      Utils.showNotification("Failed to reset data: " + error.message, "error");
    }
  }
}
document.addEventListener("DOMContentLoaded", () => {
  window.pinProtection = new PinProtection();
  pinProtection.promptUnlock(() => {
    window.app = new CashflowApp(pinProtection);
  });
});
