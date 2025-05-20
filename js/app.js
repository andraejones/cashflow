/**
 * Main application class
 */
class CashflowApp {
  /**
   * Initialize the application
   */
  constructor() {
    // Create core data store
    this.store = new TransactionStore();

    // Create managers and services
    this.recurringManager = new RecurringTransactionManager(this.store);
    this.calculationService = new CalculationService(
      this.store,
      this.recurringManager
    );

    // Create cloud sync before UI components
    this.cloudSync = new CloudSync(this.store, () => this.updateUI());

    // Create UI components with update callbacks
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

    // Initialize the app
    this.init();
  }

  /**
   * Initialize the application
   */
  async init() {
    try {
      // Clean up any HTML artifacts that may be showing as text
      this.cleanUpHtmlArtifacts();
      
      // Try to load data from cloud first
      await this.cloudSync.loadFromCloud();
    } catch (error) {
      console.error("Error loading from cloud:", error);
      // If failed to load from cloud, data is already loaded from local storage
    }

    // Generate the calendar
    this.updateUI();

    // Set up global add transaction function for the button
    window.addTransaction = () => this.transactionUI.addTransaction();
  }

  /**
   * Clean up any HTML artifacts that may be showing as text
   */
  cleanUpHtmlArtifacts() {
    const bodyChildren = document.body.childNodes;
    for (let i = 0; i < bodyChildren.length; i++) {
      const node = bodyChildren[i];
      if (node.nodeType === Node.TEXT_NODE && 
          (node.textContent.includes("<div") || 
           node.textContent.includes("modal-content"))) {
        document.body.removeChild(node);
        i--; // Adjust for the removed node
      }
    }
  }

  /**
   * Update the UI
   */
  updateUI() {
    this.calendarUI.generateCalendar();
  }

  /**
   * Export data to file
   */
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

  /**
   * Import data from file
   */
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
              // Invalidate caches after import
              this.calculationService.invalidateCache();
              this.updateUI();
              
              // Import already triggers saveData, which will schedule cloud sync if needed
              
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

  /**
   * Reset all data
   */
  resetData() {
    try {
      this.cloudSync.cancelPendingCloudSave();

      if (
        confirm(
          "Are you sure you want to reset all data? This will also clear your cloud sync credentials."
        )
      ) {
        // Reset data in store
        this.store.resetData();
        
        // Clear cloud credentials
        this.cloudSync.clearCloudCredentials();
        
        // Invalidate calculation caches
        this.calculationService.invalidateCache();
        
        // Update the UI
        this.updateUI();
        
        // Reset already triggers saveData, which will schedule cloud sync if needed
        
        Utils.showNotification("All data has been reset.");
      }
    } catch (error) {
      console.error("Error resetting data:", error);
      Utils.showNotification("Failed to reset data: " + error.message, "error");
    }
  }
}

// Initialize the application when the DOM is loaded
document.addEventListener("DOMContentLoaded", () => {
  // Create a global app instance
  window.app = new CashflowApp();
});
