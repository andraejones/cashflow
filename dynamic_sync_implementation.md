# Guide: Implementing Dynamic Cloud Sync Delay

If you decide to re-implement the dynamic cloud sync delay in the future, you will need to update two files to track active devices and dynamically scale the sync delay based on recent API usage.

Here are the exact code additions required.

## 1. Update `js/transaction-store.js`

You need to initialize and persist a new `activeDevices` registry so the app remembers which devices have synced recently.

**In the `constructor` (around line 25):**
```javascript
    this._deletedItems = {
      transactions: [],
      recurringTransactions: [],
      debts: [],
      cashInfusions: []
    };
+   this.activeDevices = {};
    this.onSaveCallbacks = [];
```

**In `loadData()`:**
```javascript
      const storedDeletedItems = decrypt(
        this.storage.getItem("deletedItems")
      );
+     const storedActiveDevices = decrypt(
+       this.storage.getItem("activeDevices")
+     );

      // ... existing code ...

      if (storedDeletedItems) {
        this._deletedItems = JSON.parse(storedDeletedItems);
      }
      
+     if (storedActiveDevices) {
+       this.activeDevices = JSON.parse(storedActiveDevices);
+     } else {
+       this.activeDevices = {};
+     }
```

**In `saveData()`:**
```javascript
      this.storage.setItem(
        "movedTransactions",
        encrypt(JSON.stringify(this.movedTransactions))
      );
+     this.storage.setItem(
+       "activeDevices",
+       encrypt(JSON.stringify(this.activeDevices))
+     );
      this.storage.setItem(
        "lastUpdated",
```

**In `resetData()`:**
```javascript
    this._deletedItems = {
      transactions: [],
      recurringTransactions: [],
      debts: [],
      cashInfusions: []
    };
+   this.activeDevices = {};
    this.saveData();
```

**In `exportData()`:**
```javascript
      monthlyNotes: this.monthlyNotes,
      debtSnowballSettings: this.debtSnowballSettings,
      _deletedItems: this._deletedItems,
+     activeDevices: this.activeDevices,
      lastUpdated: this.lastUpdated,
```

**In `importData()`:**
```javascript
      this.monthlyNotes = data.monthlyNotes || {};
      this.movedTransactions = data.movedTransactions || {};
+     this.activeDevices = data.activeDevices || {};
      this.lastUpdated = typeof data.lastUpdated === "string" ? data.lastUpdated : this.lastUpdated;
```

---

## 2. Update `js/cloud-sync.js`

This handles logging GitHub API requests, merging active device lists, and calculating the delay.

**Add helpers to the `CloudSync` class (below constructor):**
```javascript
  // Helper to log GitHub API requests for rate limiting
  _logApiRequest() {
    try {
      const historyStr = localStorage.getItem('api_request_history');
      let history = historyStr ? JSON.parse(historyStr) : [];
      const now = Date.now();
      const oneHourAgo = now - 60 * 60 * 1000;
      history = history.filter(time => time > oneHourAgo);
      history.push(now);
      localStorage.setItem('api_request_history', JSON.stringify(history));
    } catch (e) {
      console.warn('Could not log API request', e);
    }
  }

  // Helper to get number of API requests in the last hour
  _getApiRequestCount() {
    try {
      const historyStr = localStorage.getItem('api_request_history');
      let history = historyStr ? JSON.parse(historyStr) : [];
      const oneHourAgo = Date.now() - 60 * 60 * 1000;
      return history.filter(time => time > oneHourAgo).length;
    } catch (e) {
      return 0;
    }
  }
```

**Log every GitHub network request:**
Add `this._logApiRequest();` immediately before every `await fetch("https://api.github.com...")` or `gistFile.raw_url` call in the following methods:
- `createNewGist()`
- `_fetchGist()`
- `_getGistFileContent()`
- `saveToCloud()` (the PATCH request)

**Add the Active Devices merger (above `_mergeData`):**
```javascript
  // Merge active devices, keep newest, prune older than 1 hour
  _mergeActiveDevices(local, remote) {
    const merged = {};
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    const allIds = new Set([
      ...Object.keys(local || {}),
      ...Object.keys(remote || {})
    ]);
    allIds.forEach(id => {
      const localTime = local && local[id] ? new Date(local[id]).getTime() : 0;
      const remoteTime = remote && remote[id] ? new Date(remote[id]).getTime() : 0;
      const newestTime = Math.max(localTime, remoteTime);
      if (newestTime > oneHourAgo) {
        merged[id] = new Date(newestTime).toISOString();
      }
    });
    return merged;
  }
```

**Call the merger in `_mergeData()` return statement:**
```javascript
      debtSnowballSettings: this._mergeDebtSnowballSettings(...),
+     activeDevices: this._mergeActiveDevices(
+       localData.activeDevices,
+       remoteData.activeDevices
+     ),
```

**Register current device in `saveToCloud()` (before creating `dataToSave`):**
```javascript
      // Register this device as active
      const deviceId = await this._getDeviceKey();
      if (!this.store.activeDevices) {
        this.store.activeDevices = {};
      }
      this.store.activeDevices[deviceId] = new Date().toISOString();

      let dataToSave = {
        ...this.store.exportData(),
        // ...
```

**Finally, rewrite the `setTimeout` in `scheduleCloudSave()`:**
```javascript
    // Mark save time early so heartbeat checks during the delay won't false-positive
    this._lastSaveTime = Date.now();

    // Calculate dynamic delay based on API requests and active devices
    const requests = this._getApiRequestCount();
    
    // Prune and count active devices
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    let activeUserCount = 0;
    const activeDevices = this.store.activeDevices || {};
    for (const [id, timestamp] of Object.entries(activeDevices)) {
      if (new Date(timestamp).getTime() > oneHourAgo) {
        activeUserCount++;
      }
    }
    // Ensure we don't divide by zero
    activeUserCount = Math.max(1, activeUserCount);
    
    // Calculate per-user limit and dynamic delay
    const limitPerUser = 5000 / activeUserCount;
    
    // Delay scales linearly up to 10000ms as requests approach the limit
    const dynamicDelay = Math.min(10000, Math.max(0, (requests / limitPerUser) * 10000));
    const delayToUse = Math.floor(dynamicDelay);

    this.saveTimeout = setTimeout(async () => {
      // ... existing credentials check and saveToCloud() logic ...
    }, delayToUse); // <-- Replace the '0' with 'delayToUse'
```
