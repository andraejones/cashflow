/**
 * SearchUI - Manages search functionality
 */
class SearchUI {
  /**
   * Create a new SearchUI
   * @param {TransactionStore} store - The transaction store
   * @param {RecurringTransactionManager} recurringManager - Recurring transaction manager
   * @param {TransactionUI} transactionUI - Transaction UI manager
   */
  constructor(store, recurringManager, transactionUI) {
    this.store = store;
    this.recurringManager = recurringManager;
    this.transactionUI = transactionUI;
    this.currentPage = 1;
    this.resultsPerPage = 20;
    this.totalResults = 0;
    this.searchResults = [];

    this.initEventListeners();
  }

  /**
   * Initialize event listeners
   */
  initEventListeners() {
    document
      .getElementById("searchButton")
      .addEventListener("click", () => this.performSearch());
    document
      .getElementById("clearSearchButton")
      .addEventListener("click", () => this.clearSearch());

    // Add event listener for enter key in search input
    document
      .getElementById("searchInput")
      .addEventListener("keyup", (event) => {
        if (event.key === "Enter") {
          this.performSearch();
        }
      });

    // Add event listeners for advanced search controls
    document
      .getElementById("advancedSearchToggle")
      .addEventListener("click", () => this.toggleAdvancedSearch());

    document
      .getElementById("searchSortBy")
      .addEventListener("change", () => this.updateSearchResults());

    document
      .getElementById("exportResultsButton")
      .addEventListener("click", () => this.exportSearchResults());

    document
      .getElementById("prevPageButton")
      .addEventListener("click", () => this.changePage(-1));

    document
      .getElementById("nextPageButton")
      .addEventListener("click", () => this.changePage(1));

    // Make sure the modal is accessible with keyboard
    document
      .getElementById("searchModal")
      .addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          document.getElementById("searchModal").style.display = "none";
        }
      });
  }

  /**
   * Toggle advanced search options visibility
   */
  toggleAdvancedSearch() {
    const advancedControls = document.getElementById("advancedSearchControls");
    const isHidden =
      advancedControls.style.display === "none" ||
      !advancedControls.style.display;
    advancedControls.style.display = isHidden ? "block" : "none";

    const toggleButton = document.getElementById("advancedSearchToggle");
    toggleButton.textContent = isHidden
      ? "Hide Advanced Options"
      : "Show Advanced Options";
    toggleButton.setAttribute("aria-expanded", isHidden ? "true" : "false");
  }

  /**
   * Show the search modal
   */
  showSearchModal() {
    const modal = document.getElementById("searchModal");
    modal.style.display = "block";
    document.getElementById("searchInput").value = "";
    this.clearSearch();

    // Focus the search input
    setTimeout(() => {
      document.getElementById("searchInput").focus();
    }, 100);
  }

  /**
   * Change the current page of search results
   * @param {number} delta - Page change amount (+1 or -1)
   */
  changePage(delta) {
    const newPage = this.currentPage + delta;
    if (
      newPage < 1 ||
      newPage > Math.ceil(this.totalResults / this.resultsPerPage)
    ) {
      return;
    }

    this.currentPage = newPage;
    this.updateSearchResults();
  }

  /**
   * Export search results to CSV
   */
  exportSearchResults() {
    if (this.searchResults.length === 0) {
      if (typeof Utils !== 'undefined' && typeof Utils.showNotification === 'function') {
        Utils.showNotification("No results to export", "error");
      } else {
        console.error("No results to export");
      }
      return;
    }

    // Create CSV content
    let csvContent = "Date,Type,Amount,Description,Recurring\n";

    this.searchResults.forEach(({ date, transaction }) => {
      const formattedDate = date.split("-").join("/");
      const amount = transaction.amount.toFixed(2);
      // Properly escape description for CSV: replace commas and escape quotes
      const description = transaction.description.replace(/,/g, " ").replace(/"/g, '""');
      const type = transaction.type;
      const recurring = transaction.recurringId ? "Yes" : "No";

      csvContent += `${formattedDate},${type},${amount},"${description}",${recurring}\n`;
    });

    try {
      // Create and download the file
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8" });
      
      if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", "search_results.csv");
        link.style.display = "none";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        if (typeof URL.revokeObjectURL === 'function') {
          URL.revokeObjectURL(url);
        }
      } else {
        console.error("URL.createObjectURL is not supported in this environment");
      }

      if (typeof Utils !== 'undefined' && typeof Utils.showNotification === 'function') {
        Utils.showNotification("Search results exported successfully!");
      } else {
        console.log("Search results exported successfully!");
      }
    } catch (error) {
      console.error("Error exporting search results:", error);
      if (typeof Utils !== 'undefined' && typeof Utils.showNotification === 'function') {
        Utils.showNotification("Error exporting search results", "error");
      }
    }
  }

  /**
   * Perform search based on input
   */
  performSearch() {
    const searchTerm = document
      .getElementById("searchInput")
      .value.trim()
      .toLowerCase();
    const searchResults = document.getElementById("searchResults");
    const clearButton = document.getElementById("clearSearchButton");
    const exportButton = document.getElementById("exportResultsButton");
    const paginationControls = document.getElementById("paginationControls");

    searchResults.innerHTML = "";
    this.searchResults = [];
    this.totalResults = 0;
    this.currentPage = 1;

    // Safely get advanced search filters
    let dateFrom = "";
    let dateTo = "";
    let typeFilter = "";
    let minAmount = 0;
    let maxAmount = Infinity;
    let hasMinAmount = false;
    let hasMaxAmount = false;
    
    const dateFromEl = document.getElementById("dateRangeFrom");
    if (dateFromEl) dateFrom = dateFromEl.value;
    
    const dateToEl = document.getElementById("dateRangeTo");
    if (dateToEl) dateTo = dateToEl.value;
    
    const typeFilterEl = document.getElementById("transactionTypeFilter");
    if (typeFilterEl) typeFilter = typeFilterEl.value;
    
    const minAmountEl = document.getElementById("minAmountFilter");
    if (minAmountEl) {
      const rawMin = minAmountEl.value.trim();
      if (rawMin !== "") {
        minAmount = parseFloat(rawMin);
        hasMinAmount = !isNaN(minAmount);
      }
    }

    const maxAmountEl = document.getElementById("maxAmountFilter");
    if (maxAmountEl) {
      const rawMax = maxAmountEl.value.trim();
      if (rawMax !== "") {
        maxAmount = parseFloat(rawMax);
        hasMaxAmount = !isNaN(maxAmount);
      }
    }

    // If no search term and no filters are applied, show message
    if (
      searchTerm === "" &&
      !dateFrom &&
      !dateTo &&
      !typeFilter &&
      !hasMinAmount &&
      !hasMaxAmount
    ) {
      searchResults.innerHTML = "Please enter a search term or apply filters.";
      clearButton.disabled = true;
      exportButton.disabled = true;
      paginationControls.style.display = "none";
      return;
    }

    let foundTransactions = [];
    const transactions = this.store.getTransactions();

    // Helper function to check if a number matches the search term
    const matchesAmount = (amount, searchTerm) => {
      const searchNumber = parseFloat(searchTerm);
      if (!isNaN(searchNumber)) {
        return amount === searchNumber;
      }
      return false;
    };

    for (const date in transactions) {
      // Apply date filter
      if ((dateFrom && date < dateFrom) || (dateTo && date > dateTo)) {
        continue;
      }

      for (const transaction of transactions[date]) {
        // Skip hidden (already skipped) recurring transactions
        if (
          transaction.recurringId &&
          this.recurringManager.isTransactionSkipped(
            date,
            transaction.recurringId
          )
        ) {
          continue;
        }

        // Apply type filter
        if (typeFilter && transaction.type !== typeFilter) {
          continue;
        }

        // Apply amount filter only when specified
        if (
          (hasMinAmount && transaction.amount < minAmount) ||
          (hasMaxAmount && transaction.amount > maxAmount)
        ) {
          continue;
        }

        // If search term is empty, include all transactions that pass filters
        if (searchTerm === "") {
          foundTransactions.push({
            date: date,
            transaction: transaction,
          });
          continue;
        }

        // Search by description
        const descriptionMatch = transaction.description
          .toLowerCase()
          .includes(searchTerm);

        // Search by amount (exact match)
        const amountMatch = matchesAmount(transaction.amount, searchTerm);

        // Search by formatted amount with currency symbol
        const formattedAmount = transaction.amount.toFixed(2);
        const formattedAmountMatch =
          formattedAmount === searchTerm ||
          `$${formattedAmount}` === searchTerm ||
          `${transaction.type === "income" ? "+" : "-"}${formattedAmount}` ===
            searchTerm ||
          `${transaction.type === "income" ? "+" : "-"}$${formattedAmount}` ===
            searchTerm;

        if (descriptionMatch || amountMatch || formattedAmountMatch) {
          foundTransactions.push({
            date: date,
            transaction: transaction,
          });
        }
      }
    }

    // Store the total results count
    this.totalResults = foundTransactions.length;
    this.searchResults = foundTransactions;

    // Apply sorting
    this.updateSearchResults();
  }

  /**
   * Update the display of search results (for pagination and sorting)
   */
  updateSearchResults() {
    const searchResults = document.getElementById("searchResults");
    const clearButton = document.getElementById("clearSearchButton");
    const exportButton = document.getElementById("exportResultsButton");
    const paginationControls = document.getElementById("paginationControls");
    const pageInfo = document.getElementById("currentPageInfo");
    const prevButton = document.getElementById("prevPageButton");
    const nextButton = document.getElementById("nextPageButton");

    searchResults.innerHTML = "";

    if (this.searchResults.length === 0) {
      searchResults.innerHTML =
        "No transactions found matching the search criteria.";
      clearButton.disabled = true;
      exportButton.disabled = true;
      paginationControls.style.display = "none";
      return;
    }

    // Apply sorting
    const sortByEl = document.getElementById("searchSortBy");
    const sortBy = sortByEl ? sortByEl.value : "dateDesc";
    let sortedResults = [...this.searchResults];

    if (sortBy === "dateAsc") {
      sortedResults.sort((a, b) => a.date.localeCompare(b.date));
    } else if (sortBy === "dateDesc") {
      sortedResults.sort((a, b) => b.date.localeCompare(a.date));
    } else if (sortBy === "amountAsc") {
      sortedResults.sort((a, b) => a.transaction.amount - b.transaction.amount);
    } else if (sortBy === "amountDesc") {
      sortedResults.sort((a, b) => b.transaction.amount - a.transaction.amount);
    } else if (sortBy === "description") {
      sortedResults.sort((a, b) =>
        a.transaction.description.localeCompare(b.transaction.description)
      );
    }

    // Create header for search results
    const headerDiv = document.createElement("div");
    headerDiv.className = "search-results-header";
    headerDiv.innerHTML = `Found ${this.totalResults} matching transaction${
      this.totalResults > 1 ? "s" : ""
    }`;
    searchResults.appendChild(headerDiv);

    // Calculate pagination
    const totalPages = Math.ceil(this.totalResults / this.resultsPerPage);
    const startIdx = (this.currentPage - 1) * this.resultsPerPage;
    const endIdx = Math.min(startIdx + this.resultsPerPage, this.totalResults);

    // Update pagination display
    if (pageInfo) pageInfo.textContent = `Page ${this.currentPage} of ${totalPages}`;
    if (prevButton) prevButton.disabled = this.currentPage <= 1;
    if (nextButton) nextButton.disabled = this.currentPage >= totalPages;
    if (paginationControls) {
      paginationControls.style.display =
        this.totalResults > this.resultsPerPage ? "flex" : "none";
    }

    // Show current page of results
    const pageResults = sortedResults.slice(startIdx, endIdx);

    pageResults.forEach(({ date, transaction }) => {
      const resultDiv = document.createElement("div");
      const [year, month, day] = date.split("-");
      const formattedDate = `${month}/${day}/${year}`;
      const amountText = `${
        transaction.type === "income" ? "+" : "-"
      }$${transaction.amount.toFixed(2)}`;

      resultDiv.className = "search-result-item";
      resultDiv.setAttribute("role", "button");
      resultDiv.setAttribute("tabindex", "0");
      resultDiv.innerHTML = `
        <span class="search-result-date">${formattedDate}</span>
        <span class="search-result-amount ${
          transaction.type
        }">${amountText}</span>
        <span class="search-result-description">${
          transaction.description
        }</span>
        ${
          transaction.recurringId
            ? '<span class="search-result-recurring">(Recurring)</span>'
            : ""
        }
      `;

      // Add click handler to show transaction details
      resultDiv.addEventListener("click", () => {
        document.getElementById("searchModal").style.display = "none";
        this.transactionUI.showTransactionDetails(date);
      });

      // Add keyboard support
      resultDiv.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          document.getElementById("searchModal").style.display = "none";
          this.transactionUI.showTransactionDetails(date);
        }
      });

      searchResults.appendChild(resultDiv);
    });

    clearButton.disabled = false;
    exportButton.disabled = false;
  }

  /**
   * Clear search results
   */
  clearSearch() {
    const searchResults = document.getElementById("searchResults");
    const clearButton = document.getElementById("clearSearchButton");
    const exportButton = document.getElementById("exportResultsButton");
    const paginationControls = document.getElementById("paginationControls");

    searchResults.innerHTML = "";
    clearButton.disabled = true;
    exportButton.disabled = true;
    paginationControls.style.display = "none";

    document.getElementById("searchInput").value = "";
    document.getElementById("dateRangeFrom").value = "";
    document.getElementById("dateRangeTo").value = "";
    document.getElementById("transactionTypeFilter").value = "";
    document.getElementById("minAmountFilter").value = "";
    document.getElementById("maxAmountFilter").value = "";
    document.getElementById("searchSortBy").value = "dateDesc";

    this.searchResults = [];
    this.totalResults = 0;
    this.currentPage = 1;
  }
}