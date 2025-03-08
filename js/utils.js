/**
 * Utility functions for the application
 */
const Utils = {
  /**
   * Generate a unique ID for transactions and other entities
   * @returns {string} A unique identifier
   */
  generateUniqueId: function () {
    return Date.now().toString(36) + Math.random().toString(36).substring(2);
  },

  /**
   * Format a date as YYYY-MM-DD
   * @param {Date} date - The date to format
   * @returns {string} Formatted date string
   */
  formatDateString: function (date) {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, "0");
    const day = date.getDate().toString().padStart(2, "0");
    return `${year}-${month}-${day}`;
  },

  /**
   * Convert a date string to a formatted display string
   * @param {string} dateString - Date in YYYY-MM-DD format
   * @returns {string} Human-readable date
   */
  formatDisplayDate: function (dateString) {
    const [year, month, day] = dateString.split("-").map(Number);
    const dateObj = new Date(Date.UTC(year, month - 1, day));

    return dateObj.toLocaleString("default", {
      month: "long",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });
  },

  /**
   * Show a toast notification
   * @param {string} message - Message to display
   * @param {string} type - 'success' or 'error'
   */
  showNotification: function (message, type = "success") {
    const existingToasts = document.querySelectorAll(
      ".error-toast, .success-toast"
    );
    existingToasts.forEach((toast) => toast.remove());

    const toast = document.createElement("div");
    toast.className = type === "success" ? "success-toast" : "error-toast";
    toast.textContent = message;

    document.body.appendChild(toast);
    toast.style.display = "block";

    setTimeout(() => {
      toast.style.animation = "slideOut 0.3s ease-in forwards";
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  },
};
