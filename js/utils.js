// Utility helpers

const Utils = {
  
  generateUniqueId: function () {
    return Date.now().toString(36) + Math.random().toString(36).substring(2);
  },

  
  formatDateString: function (date) {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, "0");
    const day = date.getDate().toString().padStart(2, "0");
    return `${year}-${month}-${day}`;
  },

  
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
