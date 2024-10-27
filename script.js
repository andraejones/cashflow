let currentDate = new Date();
let transactions = {};
let monthlyBalances = {};
let recurringTransactions = [];

function loadData() {
    const storedTransactions = localStorage.getItem('transactions');
    const storedMonthlyBalances = localStorage.getItem('monthlyBalances');
    const storedRecurringTransactions = localStorage.getItem('recurringTransactions');
    if (storedTransactions) {
        transactions = JSON.parse(storedTransactions);
    }
    if (storedMonthlyBalances) {
        monthlyBalances = JSON.parse(storedMonthlyBalances);
    }
    if (storedRecurringTransactions) {
        recurringTransactions = JSON.parse(storedRecurringTransactions);
    }
}

function saveData() {
    localStorage.setItem('transactions', JSON.stringify(transactions));
    localStorage.setItem('monthlyBalances', JSON.stringify(monthlyBalances));
    localStorage.setItem('recurringTransactions', JSON.stringify(recurringTransactions));
}

function resetData() {
    if (confirm('Are you sure you want to reset all data? This will also clear your cloud sync credentials.')) {
        transactions = {};
        monthlyBalances = {};
        recurringTransactions = [];
        clearCloudCredentials();
        localStorage.clear();
        currentDate = new Date();
        generateCalendar();
        showNotification('All data has been reset.');
    }
}

loadData();

function updateMonthlyBalances() {
    const sortedMonths = Object.keys(monthlyBalances).sort();
    let previousBalance = 0;

    sortedMonths.forEach((monthKey, index) => {
        const [year, month] = monthKey.split('-').map(Number);
        let monthIncome = 0;
        let monthExpense = 0;

        for (let day = 1; day <= 31; day++) {
            const dateString = `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
            if (transactions[dateString]) {
                transactions[dateString].forEach(t => {
                    if (t.type === 'income') {
                        monthIncome += t.amount;
                    } else {
                        monthExpense += t.amount;
                    }
                });
            }
        }

        monthlyBalances[monthKey] = {
            startingBalance: previousBalance,
            endingBalance: previousBalance + monthIncome - monthExpense
        };

        previousBalance = monthlyBalances[monthKey].endingBalance;
    });

    saveData();
}

function generateCalendar() {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();

    const monthNames = ["January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"];

    const currentMonthElement = document.getElementById('currentMonth');
    const today = new Date();
    
    if (year === today.getFullYear() && month === today.getMonth()) {
        currentMonthElement.textContent = `${monthNames[month]} ${year}`;
        currentMonthElement.onclick = null;
        currentMonthElement.style.cursor = 'default';
    } else {
        currentMonthElement.textContent = `${monthNames[month]} ${year} ⏎`;
        currentMonthElement.onclick = returnToCurrentMonth;
        currentMonthElement.style.cursor = 'pointer';
    }

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const calendarDays = document.getElementById('calendarDays');
    calendarDays.innerHTML = '';

    for (let i = 0; i < firstDay; i++) {
        const day = document.createElement('div');
        day.classList.add('day', 'other-month');
        calendarDays.appendChild(day);
    }

    let monthlyIncome = 0;
    let monthlyExpense = 0;

    const monthKey = `${year}-${month + 1}`;
    
    updateMonthlyBalances();

    if (!monthlyBalances[monthKey]) {
        const previousMonth = new Date(year, month - 1, 1);
        const previousMonthKey = `${previousMonth.getFullYear()}-${previousMonth.getMonth() + 1}`;
        const previousBalance = monthlyBalances[previousMonthKey] ? monthlyBalances[previousMonthKey].endingBalance : 0;
        monthlyBalances[monthKey] = { startingBalance: previousBalance, endingBalance: previousBalance };
    }
    let currentBalance = monthlyBalances[monthKey].startingBalance;

    applyRecurringTransactions(year, month);

    for (let i = 1; i <= daysInMonth; i++) {
        const day = document.createElement('div');
        day.classList.add('day');
        day.innerHTML = `${i}<div class="day-content"></div>`;
        if (year === today.getFullYear() && month === today.getMonth() && i === today.getDate()) {
            day.classList.add('current');
        }

        const dateString = `${year}-${(month + 1).toString().padStart(2, '0')}-${i.toString().padStart(2, '0')}`;
        let dailyIncome = 0;
        let dailyExpense = 0;
        let transactionCount = 0;

        if (transactions[dateString]) {
            transactionCount = transactions[dateString].length;
            transactions[dateString].forEach(t => {
                if (t.type === 'income') {
                    dailyIncome += t.amount;
                    monthlyIncome += t.amount;
                    currentBalance += t.amount;
                } else {
                    dailyExpense += t.amount;
                    monthlyExpense += t.amount;
                    currentBalance -= t.amount;
                }
            });
        }

        day.querySelector('.day-content').innerHTML = `
            ${dailyIncome > 0 ? `<div class="income">+${dailyIncome.toFixed(2)}</div>` : ''}
            ${dailyExpense > 0 ? `<div class="expense">-${dailyExpense.toFixed(2)}</div>` : ''}
            <div class="balance">${currentBalance.toFixed(2)}</div>
            ${transactionCount > 0 ? `<div class="transaction-count">(${transactionCount})</div>` : ''}
        `;

        day.addEventListener('click', () => showTransactionDetails(dateString));
        calendarDays.appendChild(day);
    }

    const remainingDays = 42 - (firstDay + daysInMonth);
    for (let i = 1; i <= remainingDays; i++) {
        const day = document.createElement('div');
        day.classList.add('day', 'other-month');
        day.innerHTML = `${i}<div class="day-content"></div>`;
        calendarDays.appendChild(day);
    }

    monthlyBalances[monthKey].endingBalance = currentBalance;

    const startingBalance = monthlyBalances[monthKey].startingBalance;
    document.getElementById('monthSummary').innerHTML = `
        Monthly Summary: Starting Balance: $${startingBalance.toFixed(2)} | Income: $${monthlyIncome.toFixed(2)} | Expenses: $${monthlyExpense.toFixed(2)} | Ending Balance: $${currentBalance.toFixed(2)}
    `;

    document.getElementById('calendarOptions').innerHTML = `
        <span class="calendar-option" onclick="searchTransactions()">Search</span> | 
        <span class="calendar-option" onclick="exportData()">Save to Device</span> | 
        <span class="calendar-option" onclick="importData()">Load from Device</span> | 
        <span class="calendar-option" onclick="saveToCloud()">Save to Cloud</span> | 
        <span class="calendar-option" onclick="loadFromCloud()">Load from Cloud</span> | 
        <span class="calendar-option" onclick="resetData()">Reset</span>
    `;

    saveData();
}

function isValidMonth(date) {
    const monthKey = `${date.getFullYear()}-${date.getMonth() + 1}`;
    return monthlyBalances.hasOwnProperty(monthKey) || date >= new Date();
}

function changeMonth(delta) {
    const newDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + delta, 1);
    if (delta > 0 && isWithinAllowedRange(newDate)) {
        currentDate = newDate;
        generateCalendar();
    } else if (delta < 0 && isValidMonth(newDate)) {
        currentDate = newDate;
        generateCalendar();
    } else if (delta > 0) {
        alert("You have reached the maximum available forecast.");
    } else {
        alert("There are no transactions previous months.");
    }
}

function isWithinAllowedRange(date) {
    const today = new Date();
    const maxAllowedDate = new Date(today.getFullYear(), today.getMonth() + 11, 1);
    return date <= maxAllowedDate;
}

function returnToCurrentMonth() {
    currentDate = new Date();
    generateCalendar();
}

function showTransactionDetails(date) {
    const modal = document.getElementById('transactionModal');
    const transactionDate = document.getElementById('transactionDate');
    const modalTransactions = document.getElementById('modalTransactions');
    const modalDate = document.getElementById('modalDate');

    transactionDate.value = date;
    
    const [year, month, day] = date.split('-').map(Number);
    const dateObj = new Date(Date.UTC(year, month - 1, day));
    
    const formattedDate = dateObj.toLocaleString('default', { 
        month: 'long', 
        day: 'numeric', 
        year: 'numeric',
        timeZone: 'UTC'
    });
    
    modalDate.textContent = formattedDate;
    modalTransactions.innerHTML = '';

    if (transactions[date]) {
        transactions[date].forEach((t, index) => {
            const transactionDiv = document.createElement('div');
            const isRecurring = isRecurringTransaction(t, date);
            transactionDiv.innerHTML = `
                <span class="${t.type}">${t.type === 'income' ? '+' : '-'}$${t.amount.toFixed(2)}</span>
                ${t.description ? ` - ${t.description}` : ''}
                ${isRecurring ? '(Recurring)' : ''}
                <span class="edit-btn" onclick="showEditForm('${date}', ${index})">Edit</span>
                <span class="delete-btn" onclick="deleteTransaction('${date}', ${index})">Delete</span>
                <div class="edit-form" id="edit-form-${date}-${index}">
                    <input type="number" id="edit-amount-${date}-${index}" value="${t.amount}">
                    <select id="edit-type-${date}-${index}">
                        <option value="expense" ${t.type === 'expense' ? 'selected' : ''}>Expense</option>
                        <option value="income" ${t.type === 'income' ? 'selected' : ''}>Income</option>
                    </select>
                    <input type="text" id="edit-description-${date}-${index}" value="${t.description}">
                    ${isRecurring ? `
                        <select id="edit-recurrence-${date}-${index}">
                            <option value="this">Edit this occurrence only</option>
                            <option value="future">Edit this and future occurrences</option>
                        </select>
                    ` : ''}
                    <button onclick="saveEdit('${date}', ${index})">Save</button>
                </div>
            `;
            modalTransactions.appendChild(transactionDiv);
        });
    } else {
        modalTransactions.innerHTML = '<p>No transactions for this date.</p>';
    }

    modal.style.display = 'block';
}

function isRecurringTransaction(transaction, date) {
    return transaction.isRecurring || recurringTransactions.some(rt => 
        rt.amount === transaction.amount &&
        rt.type === transaction.type &&
        rt.description === transaction.description &&
        new Date(rt.startDate) <= new Date(date)
    );
}

function showEditForm(date, index) {
    const editForm = document.getElementById(`edit-form-${date}-${index}`);
    editForm.style.display = 'block';
}

function saveEdit(date, index) {
    const amount = parseFloat(document.getElementById(`edit-amount-${date}-${index}`).value);
    const type = document.getElementById(`edit-type-${date}-${index}`).value;
    const description = document.getElementById(`edit-description-${date}-${index}`).value;

    if (isNaN(amount) || amount <= 0) {
        alert('Please enter a valid amount');
        return;
    }

    const transaction = transactions[date][index];
    const isRecurring = transaction.isRecurring;

    if (isRecurring) {
        const editRecurrence = document.getElementById(`edit-recurrence-${date}-${index}`).value;
        const recurringTransaction = findRecurringTransaction(transaction, date);

        if (editRecurrence === 'this') {
            transactions[date][index] = { 
                amount, 
                type, 
                description, 
                isRecurring: true,
                modifiedRecurring: true,
                originalAmount: recurringTransaction.amount,
                originalType: recurringTransaction.type,
                originalDescription: recurringTransaction.description
            };
        } else if (editRecurrence === 'future') {
            const startDate = new Date(date);
            const newRecurringTransaction = {
                startDate: startDate.toISOString().split('T')[0],
                amount,
                type,
                description,
                recurrence: recurringTransaction.recurrence
            };
            
            const previousRecurringTransaction = {
                ...recurringTransaction,
                endDate: new Date(startDate.getTime() - 86400000).toISOString().split('T')[0] 
            };
            
            const index = recurringTransactions.findIndex(rt => isSameRecurringTransaction(rt, recurringTransaction));
            if (index !== -1) {
                recurringTransactions[index] = previousRecurringTransaction;
                recurringTransactions.push(newRecurringTransaction);
            }

            Object.keys(transactions).forEach(dateKey => {
                if (new Date(dateKey) >= startDate) {
                    transactions[dateKey] = transactions[dateKey].map(t => {
                        if (t.isRecurring && isSameRecurringTransaction(t, recurringTransaction)) {
                            return {
                                amount,
                                type,
                                description,
                                isRecurring: true
                            };
                        }
                        return t;
                    });
                }
            });
        }
    } else {

        transactions[date][index] = { amount, type, description };
    }

    showTransactionDetails(date);
    generateCalendar();

    saveData();
}

function deleteTransaction(date, index) {
    if (confirm('Are you sure you want to delete this transaction? If it\'s a recurring transaction, all future occurrences will be deleted as well.')) {
        const transaction = transactions[date][index];
        
        const recurringIndex = recurringTransactions.findIndex(rt => 
            rt.amount === transaction.amount &&
            rt.type === transaction.type &&
            rt.description === transaction.description &&
            new Date(rt.startDate) <= new Date(date)
        );

        if (recurringIndex !== -1) {
            recurringTransactions.splice(recurringIndex, 1);

            Object.keys(transactions).forEach(dateKey => {
                if (new Date(dateKey) >= new Date(date)) {
                    transactions[dateKey] = transactions[dateKey].filter(t => 
                        !(t.amount === transaction.amount &&
                        t.type === transaction.type &&
                        t.description === transaction.description)
                    );
                    if (transactions[dateKey].length === 0) {
                        delete transactions[dateKey];
                    }
                }
            });
        } else {
            transactions[date].splice(index, 1);
            if (transactions[date].length === 0) {
                delete transactions[date];
            }
        }

        showTransactionDetails(date);
        generateCalendar();
        saveData();
    }
}

function applyRecurringTransactions(year, month) {
    const startOfMonth = new Date(Date.UTC(year, month, 1));
    const endOfMonth = new Date(Date.UTC(year, month + 1, 0));

    for (let day = 1; day <= endOfMonth.getUTCDate(); day++) {
        const dateString = `${year}-${(month + 1).toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
        if (transactions[dateString]) {
            transactions[dateString] = transactions[dateString].filter(t => !t.isRecurring || t.modifiedRecurring);
            if (transactions[dateString].length === 0) {
                delete transactions[dateString];
            }
        }
    }

    recurringTransactions.forEach(rt => {
        const startDate = new Date(rt.startDate);
        const endDate = rt.endDate ? new Date(rt.endDate) : null;
        if (startDate <= endOfMonth && (!endDate || endDate >= startOfMonth)) {
            let currentDate = new Date(Math.max(startDate, startOfMonth));

            while (currentDate <= endOfMonth && (!endDate || currentDate <= endDate)) {
                const dateString = currentDate.toISOString().split('T')[0];
                
                if (shouldApplyRecurringTransaction(rt, startDate, currentDate)) {
                    if (!transactions[dateString]) {
                        transactions[dateString] = [];
                    }

                    const existingModifiedTransaction = transactions[dateString].find(
                        t => t.modifiedRecurring && isSameRecurringTransaction(t, rt)
                    );

                    if (!existingModifiedTransaction) {
                        transactions[dateString].push({
                            amount: rt.amount,
                            type: rt.type,
                            description: rt.description,
                            isRecurring: true
                        });
                    }
                }

                currentDate.setUTCDate(currentDate.getUTCDate() + 1);
            }
        }
    });

    saveData();
}

function isSameRecurringTransaction(t1, t2) {
    return (t1.originalAmount || t1.amount) === (t2.originalAmount || t2.amount) &&
           (t1.originalType || t1.type) === (t2.originalType || t2.type) &&
           (t1.originalDescription || t1.description) === (t2.originalDescription || t2.description);
}


function shouldApplyRecurringTransaction(rt, startDate, currentDate) {
    switch (rt.recurrence) {
        case 'daily':
            return true;
        case 'weekly':
            return currentDate.getUTCDay() === startDate.getUTCDay();
        case 'monthly':
            const lastDayOfMonth = new Date(currentDate.getUTCFullYear(), currentDate.getUTCMonth() + 1, 0).getUTCDate();
            
            if (startDate.getUTCDate() > lastDayOfMonth) {
                return currentDate.getUTCDate() === lastDayOfMonth;
            }
            
            return currentDate.getUTCDate() === startDate.getUTCDate();
        case 'yearly':
            return currentDate.getUTCDate() === startDate.getUTCDate() && currentDate.getUTCMonth() === startDate.getUTCMonth();
        default:
            return false;
    }
}

function addTransaction() {
    const date = document.getElementById('transactionDate').value;
    const amount = parseFloat(document.getElementById('transactionAmount').value);
    const type = document.getElementById('transactionType').value;
    const description = document.getElementById('transactionDescription').value;
    const recurrence = document.getElementById('transactionRecurrence').value;

    if (!date || isNaN(amount) || amount <= 0) {
        alert('Please enter valid date and amount');
        return;
    }

    if (recurrence === 'once') {
        if (!transactions[date]) {
            transactions[date] = [];
        }
        transactions[date].push({ amount, type, description });
    } else {
        recurringTransactions.push({
            startDate: date,
            amount,
            type,
            description,
            recurrence
        });
    }

    generateCalendar();
    
    document.getElementById('transactionAmount').value = '';
    document.getElementById('transactionDescription').value = '';
    document.getElementById('transactionRecurrence').value = 'once';

    saveData();

    document.getElementById('transactionModal').style.display = 'none';
}

function findRecurringTransaction(transaction, date) {
    return recurringTransactions.find(rt => 
        rt.amount === (transaction.originalAmount || transaction.amount) &&
        rt.type === (transaction.originalType || transaction.type) &&
        rt.description === (transaction.originalDescription || transaction.description) &&
        new Date(rt.startDate) <= new Date(date)
    );
}

function isSameRecurringTransaction(t1, t2) {
    return (t1.originalAmount || t1.amount) === (t2.originalAmount || t2.amount) &&
           (t1.originalType || t1.type) === (t2.originalType || t2.type) &&
           (t1.originalDescription || t1.description) === (t2.originalDescription || t2.description);
}

function exportData() {
    const data = {
        transactions: transactions,
        monthlyBalances: monthlyBalances,
        recurringTransactions: recurringTransactions
    };
    
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = String(now.getFullYear()).slice(-2);
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    
    const filename = `cashflow_data_${day}-${month}-${year}_${hours}${minutes}.json`;
    
    const blob = new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function importData() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    
    input.onchange = e => {
        const file = e.target.files[0];
        const reader = new FileReader();
        
        reader.onload = readerEvent => {
            try {
                const content = JSON.parse(readerEvent.target.result);
                
                if (content.transactions && content.monthlyBalances && content.recurringTransactions) {
                    transactions = content.transactions;
                    monthlyBalances = content.monthlyBalances;
                    recurringTransactions = content.recurringTransactions;
                    
                    saveData();
                    generateCalendar();
                    alert('Data imported successfully!');
                } else {
                    throw new Error('Invalid file format');
                }
            } catch (error) {
                alert('Error importing data: ' + error.message);
            }
        }
        
        reader.readAsText(file);
    }
    
    input.click();
}

function searchTransactions() {
    const modal = document.getElementById('searchModal');
    modal.style.display = 'block';
    document.getElementById('searchInput').value = '';
    clearSearch();
}

function performSearch() {
    const searchTerm = document.getElementById('searchInput').value.trim().toLowerCase();
    const searchResults = document.getElementById('searchResults');
    const clearButton = document.getElementById('clearSearchButton');
    searchResults.innerHTML = '';

    let foundTransactions = [];

    // Helper function to check if a number matches the search term
    const matchesAmount = (amount, searchTerm) => {
        const searchNumber = parseFloat(searchTerm);
        if (!isNaN(searchNumber)) {
            return amount === searchNumber;
        }
        return false;
    };

    for (const date in transactions) {
        for (const transaction of transactions[date]) {
            // Search by description (with trimmed input)
            const descriptionMatch = transaction.description.toLowerCase().includes(searchTerm);
            
            // Search by amount (exact match)
            const amountMatch = matchesAmount(transaction.amount, searchTerm);
            
            // Search by formatted amount with currency symbol
            const formattedAmount = transaction.amount.toFixed(2);
            const formattedAmountMatch = 
                formattedAmount === searchTerm ||
                `$${formattedAmount}` === searchTerm ||
                `${transaction.type === 'income' ? '+' : '-'}${formattedAmount}` === searchTerm ||
                `${transaction.type === 'income' ? '+' : '-'}$${formattedAmount}` === searchTerm;

            if (descriptionMatch || amountMatch || formattedAmountMatch) {
                foundTransactions.push({
                    date: date,
                    transaction: transaction
                });
            }
        }
    }

    foundTransactions.sort((a, b) => new Date(b.date) - new Date(a.date));

    if (foundTransactions.length > 0) {
        // Create header for search results
        const headerDiv = document.createElement('div');
        headerDiv.className = 'search-results-header';
        headerDiv.innerHTML = `Found ${foundTransactions.length} matching transaction${foundTransactions.length > 1 ? 's' : ''}`;
        searchResults.appendChild(headerDiv);

        foundTransactions.forEach(({ date, transaction }) => {
            const resultDiv = document.createElement('div');
            const [year, month, day] = date.split('-');
            const formattedDate = `${month}/${day}/${year}`;
            const amountText = `${transaction.type === 'income' ? '+' : '-'}$${transaction.amount.toFixed(2)}`;
            
            resultDiv.className = 'search-result-item';
            resultDiv.innerHTML = `
                <span class="search-result-date">${formattedDate}</span>
                <span class="search-result-amount ${transaction.type}">${amountText}</span>
                <span class="search-result-description">${transaction.description}</span>
            `;
            
            // Add click handler to show transaction details
            resultDiv.addEventListener('click', () => {
                document.getElementById('searchModal').style.display = 'none';
                showTransactionDetails(date);
            });
            
            searchResults.appendChild(resultDiv);
        });
    } else {
        searchResults.innerHTML = 'No transactions found matching the search term.';
    }

    clearButton.disabled = foundTransactions.length === 0;
}

function clearSearch() {
    const searchResults = document.getElementById('searchResults');
    const clearButton = document.getElementById('clearSearchButton');
    searchResults.innerHTML = '';
    clearButton.disabled = true;
}

/* async function saveToCloud() {
    const data = {
        transactions: transactions,
        monthlyBalances: monthlyBalances,
        recurringTransactions: recurringTransactions,
        lastUpdated: new Date().toISOString()
    };
    
    try {
        const response = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
            method: 'PATCH',
            headers: {
                'Authorization': `token ${GITHUB_TOKEN}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                files: {
                    'cashflow_data.json': {
                        content: JSON.stringify(data, null, 2)
                    }
                }
            })
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        alert('Data saved to cloud successfully!');
        
    } catch (error) {
        console.error('Error saving to cloud:', error);
        alert('Failed to save to cloud. Data saved locally only.');
    }
}

async function loadFromCloud() {
    try {
        const response = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
            headers: {
                'Authorization': `token ${GITHUB_TOKEN}`
            }
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const gist = await response.json();
        const content = gist.files['cashflow_data.json'].content;
        const data = JSON.parse(content);
        
        // Update local data
        transactions = data.transactions || {};
        monthlyBalances = data.monthlyBalances || {};
        recurringTransactions = data.recurringTransactions || [];
        
        // Save to local storage as backup
        saveData();
        
        // Refresh the calendar
        generateCalendar();
        
        alert('Data loaded from cloud successfully!');
        
    } catch (error) {
        console.error('Error loading from cloud:', error);
        alert('Failed to load from cloud. Using local data.');
    }
}
*/

document.querySelectorAll('.close').forEach(closeBtn => {
    closeBtn.onclick = function() {
        document.getElementById('transactionModal').style.display = 'none';
        document.getElementById('searchModal').style.display = 'none';
        document.getElementById('transactionAmount').value = '';
        document.getElementById('transactionDescription').value = '';
        document.getElementById('transactionRecurrence').value = 'once';
    }
});

window.onclick = function(event) {
    const transactionModal = document.getElementById('transactionModal');
    const searchModal = document.getElementById('searchModal');
    if (event.target == transactionModal) {
        // transactionModal.style.display = 'none';
    }
    if (event.target == searchModal) {
        searchModal.style.display = 'none';
    }
}

// Update the initialization
document.addEventListener('DOMContentLoaded', function() {
    loadData();
});

function showNotification(message, type = 'success') {

    const existingToasts = document.querySelectorAll('.error-toast, .success-toast');
    existingToasts.forEach(toast => toast.remove());
    
    const toast = document.createElement('div');
    toast.className = type === 'success' ? 'success-toast' : 'error-toast';
    toast.textContent = message;
    
    document.body.appendChild(toast);
    toast.style.display = 'block';
    
    setTimeout(() => {
        toast.style.animation = 'slideOut 0.3s ease-in forwards';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

async function saveToCloud() {
    const syncIndicator = document.querySelector('.cloud-sync-indicator');
    if (syncIndicator) syncIndicator.className = 'cloud-sync-indicator syncing';
    
    try {
        let { token, gistId } = getCloudCredentials();
        
        if (!token || !gistId) {
            const credentials = await promptForCredentials();
            token = credentials.token;
            gistId = credentials.gistId;
            setCloudCredentials(token, gistId);
        }
        
        const data = {
            transactions: transactions,
            monthlyBalances: monthlyBalances,
            recurringTransactions: recurringTransactions,
            lastUpdated: new Date().toISOString()
        };
        
        const response = await fetch(`https://api.github.com/gists/${gistId}`, {
            method: 'PATCH',
            headers: {
                'Authorization': `token ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                files: {
                    'cashflow_data.json': {
                        content: JSON.stringify(data, null, 2)
                    }
                }
            })
        });
        
        if (!response.ok) {
            if (response.status === 401) {
                clearCloudCredentials();
                throw new Error('Invalid GitHub token');
            }
            if (response.status === 404) {
                clearCloudCredentials();
                throw new Error('Invalid Gist ID');
            }
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        if (syncIndicator) syncIndicator.className = 'cloud-sync-indicator synced';
        showNotification('Data saved to cloud successfully!');
        
    } catch (error) {
        console.error('Error saving to cloud:', error);
        if (syncIndicator) syncIndicator.className = 'cloud-sync-indicator error';
        showNotification(error.message || 'Failed to save to cloud. Data saved locally only.', 'error');
    }
}


async function loadFromCloud() {
    const syncIndicator = document.querySelector('.cloud-sync-indicator');
    if (syncIndicator) syncIndicator.className = 'cloud-sync-indicator syncing';
    
    try {
        let { token, gistId } = getCloudCredentials();
        
        if (!token || !gistId) {
            const credentials = await promptForCredentials();
            token = credentials.token;
            gistId = credentials.gistId;
            setCloudCredentials(token, gistId);
        }
        
        const response = await fetch(`https://api.github.com/gists/${gistId}`, {
            headers: {
                'Authorization': `token ${token}`
            }
        });
        
        if (!response.ok) {
            if (response.status === 401) {
                clearCloudCredentials();
                throw new Error('Invalid GitHub token');
            }
            if (response.status === 404) {
                clearCloudCredentials();
                throw new Error('Invalid Gist ID');
            }
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const gist = await response.json();
        const content = gist.files['cashflow_data.json'].content;
        const data = JSON.parse(content);
        
        transactions = data.transactions || {};
        monthlyBalances = data.monthlyBalances || {};
        recurringTransactions = data.recurringTransactions || [];
        
        saveData();
        generateCalendar();
        
        if (syncIndicator) syncIndicator.className = 'cloud-sync-indicator synced';
        showNotification('Data loaded from cloud successfully!');
        
    } catch (error) {
        console.error('Error loading from cloud:', error);
        if (syncIndicator) syncIndicator.className = 'cloud-sync-indicator error';
        showNotification(error.message || 'Failed to load from cloud. Using local data.', 'error');
    }
}

function getCloudCredentials() {
    const token = localStorage.getItem('github_token');
    const gistId = localStorage.getItem('gist_id');
    return { token, gistId };
}

function setCloudCredentials(token, gistId) {
    localStorage.setItem('github_token', token);
    localStorage.setItem('gist_id', gistId);
}

function clearCloudCredentials() {
    localStorage.removeItem('github_token');
    localStorage.removeItem('gist_id');
}

async function promptForCredentials() {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.display = 'block';
    
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 400px;">
            <span class="close">&times;</span>
            <h3>Cloud Sync Setup</h3>
            <p>Please enter your GitHub credentials:</p>
            <div style="margin: 15px 0;">
                <label for="github-token">GitHub Token:</label><br>
                <input type="password" id="github-token" style="width: 100%; padding: 8px; margin: 5px 0;" placeholder="ghp_...">
            </div>
            <div style="margin: 15px 0;">
                <label for="gist-id">Gist ID:</label><br>
                <input type="text" id="gist-id" style="width: 100%; padding: 8px; margin: 5px 0;" placeholder="Enter Gist ID">
            </div>
            <button id="save-credentials" style="padding: 8px 16px; background-color: #3498db; color: white; border: none; border-radius: 4px; cursor: pointer;">
                Save Credentials
            </button>
            <p style="font-size: 12px; color: #666; margin-top: 10px;">
                Note: Credentials are stored locally in your browser and can be cleared using the Reset option.
            </p>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    return new Promise((resolve, reject) => {
        const closeBtn = modal.querySelector('.close');
        const saveBtn = modal.querySelector('#save-credentials');
        
        closeBtn.onclick = () => {
            document.body.removeChild(modal);
            reject(new Error('Credentials entry cancelled'));
        };
        
        saveBtn.onclick = () => {
            const token = modal.querySelector('#github-token').value.trim();
            const gistId = modal.querySelector('#gist-id').value.trim();
            
            if (!token || !gistId) {
                alert('Please enter both GitHub token and Gist ID');
                return;
            }
            
            document.body.removeChild(modal);
            resolve({ token, gistId });
        };
    });
}

document.getElementById('prevMonth').addEventListener('click', () => changeMonth(-1));
document.getElementById('nextMonth').addEventListener('click', () => changeMonth(1));
document.getElementById('transactionDate').valueAsDate = new Date();

generateCalendar();