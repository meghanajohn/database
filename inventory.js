const STORAGE_KEY = "stockwise_inventory_demo_v1";

window.stockwise = {
  products: [],
  inventory: [],
  transfers: [],

  // Read CSV files, using the real Stockwise columns.
  parseCSV(text) {
    const rows = [];
    let row = [], cell = "", quoted = false;

    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      const next = text[i + 1];

      if (c === '"' && quoted && next === '"') {
        cell += '"';
        i++;
      } else if (c === '"') {
        quoted = !quoted;
      } else if (c === "," && !quoted) {
        row.push(cell);
        cell = "";
      } else if ((c === "\n" || c === "\r") && !quoted) {
        if (c === "\r" && next === "\n") i++;
        row.push(cell);
        if (row.some(v => v.trim() !== "")) rows.push(row);
        row = [];
        cell = "";
      } else {
        cell += c;
      }
    }

    if (cell || row.length) {
      row.push(cell);
      rows.push(row);
    }

    const headers = rows.shift().map(h => h.trim().replace(/^\uFEFF/, ""));

    return rows.map(values =>
      Object.fromEntries(
        headers.map((h, i) => [h, (values[i] ?? "").trim()])
      )
    );
  },

  async init() {
    const [productsResponse, inventoryResponse] =
      await Promise.all([
        fetch("./products.csv"),
        fetch("./inventory.csv")
      ]);

    if (!productsResponse.ok || !inventoryResponse.ok) {
      throw new Error(
        "CSV files could not load. Check their names and locations."
      );
    }

    const [productsText, inventoryText] = await Promise.all([
      productsResponse.text(),
      inventoryResponse.text()
    ]);

    this.products = this.parseCSV(productsText).map(p => ({
      ...p,
      selling_price: Number(p.selling_price) || 0
    }));

    const productSKUs = new Set(this.products.map(p => p.sku));

    const originalInventory = this.parseCSV(inventoryText)
      .filter(row => productSKUs.has(row.sku))
      .map(row => ({
        sku: row.sku,
        store: row.store,
        stock: Number(row.stock) || 0,
        ageing_days: Number(row.ageing_days) || 0
      }));

    // Restore saved demo stock if available.
    const saved = localStorage.getItem(STORAGE_KEY);

    this.inventory = saved
      ? JSON.parse(saved)
      : originalInventory;

    this.originalInventory = originalInventory;
    this.transfers = JSON.parse(
      localStorage.getItem(STORAGE_KEY + "_transfers") || "[]"
    );

    this.save();
    this.notify();

    console.log("Stockwise loaded:", {
      products: this.products.length,
      inventoryRows: this.inventory.length,
      stores: this.getStores()
    });
  },

  save() {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(this.inventory)
    );

    localStorage.setItem(
      STORAGE_KEY + "_transfers",
      JSON.stringify(this.transfers)
    );
  },

  notify() {
    window.dispatchEvent(
      new CustomEvent("stockwise-data-loaded", {
        detail: {
          products: this.products,
          inventory: this.inventory,
          transfers: this.transfers
        }
      })
    );
  },

  getStores() {
    return [...new Set(this.inventory.map(row => row.store))]
      .sort();
  },

  getInventory() {
    return this.inventory.map(row => ({
      ...row,
      ...this.products.find(p => p.sku === row.sku)
    }));
  },

  getStock(sku, store) {
    return this.inventory.find(
      row => row.sku === sku && row.store === store
    );
  },

  // Change stock and persist the new quantity.
  updateStock(sku, store, quantity) {
    quantity = Number(quantity);

    if (!Number.isInteger(quantity) || quantity < 0) {
      throw new Error("Stock must be a non-negative whole number.");
    }

    const row = this.getStock(sku, store);

    if (!row) throw new Error("Inventory record not found.");

    row.stock = quantity;
    this.save();
    this.notify();

    return row;
  },

  // Demo transfer: move stock between two real store names.
  transferStock(sku, fromStore, toStore, quantity) {
    quantity = Number(quantity);

    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new Error("Enter a positive whole-number quantity.");
    }

    if (fromStore === toStore) {
      throw new Error("Choose two different stores.");
    }

    const source = this.getStock(sku, fromStore);
    const destination = this.getStock(sku, toStore);

    if (!source) throw new Error("Source stock not found.");
    if (source.stock < quantity) {
      throw new Error("Not enough stock at the source store.");
    }

    // If destination record doesn't exist, create it.
    const destinationRow = destination || {
      sku,
      store: toStore,
      stock: 0,
      ageing_days: 0
    };

    source.stock -= quantity;

    if (!destination) this.inventory.push(destinationRow);
    destinationRow.stock += quantity;

    const transfer = {
      id: "TR-" + Date.now(),
      sku,
      from: fromStore,
      to: toStore,
      quantity,
      status: "Completed",
      createdAt: new Date().toISOString()
    };

    this.transfers.unshift(transfer);
    this.save();
    this.notify();

    return transfer;
  },

  // Restore the original CSV data for another clean demo.
  resetDemo() {
    this.inventory = this.originalInventory.map(row => ({ ...row }));
    this.transfers = [];
    this.save();
    this.notify();
  }
};

window.stockwise.init().catch(error => {
  console.error("Stockwise loading error:", error);
});
