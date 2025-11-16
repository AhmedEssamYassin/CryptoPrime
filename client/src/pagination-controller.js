export class PaginationController {
    constructor(itemsPerPage = 10) {
        this.itemsPerPage = itemsPerPage;
        this.currentPage = 1;
        this.totalPages = 1;
        this.allItems = [];
        this.onPageChangeCallback = null;
    }

    /**
     * Set the complete list of items to paginate
     * @param {Array} items - Array of items to paginate
     */
    setItems(items) {
        this.allItems = items;
        this.totalPages = Math.ceil(items.length / this.itemsPerPage);

        // Reset to page 1 if current page exceeds total pages
        if (this.currentPage > this.totalPages) {
            this.currentPage = Math.max(1, this.totalPages);
        }
    }

    /**
     * Add a single item to the collection
     * @param {*} item - Item to add
     */
    addItem(item) {
        this.allItems.push(item);
        this.totalPages = Math.ceil(this.allItems.length / this.itemsPerPage);
    }

    /**
     * Get items for the current page
     * @returns {Array} Items for current page
     */
    getCurrentPageItems() {
        const startIdx = (this.currentPage - 1) * this.itemsPerPage;
        const endIdx = Math.min(startIdx + this.itemsPerPage, this.allItems.length);
        return this.allItems.slice(startIdx, endIdx);
    }

    /**
     * Get items for a specific page with their global indices
     * @returns {Array} Array of objects with {item, globalIndex}
     */
    getCurrentPageItemsWithIndices() {
        const startIdx = (this.currentPage - 1) * this.itemsPerPage;
        const endIdx = Math.min(startIdx + this.itemsPerPage, this.allItems.length);

        return this.allItems.slice(startIdx, endIdx).map((item, localIdx) => ({
            item,
            globalIndex: startIdx + localIdx
        }));
    }

    /**
     * Navigate to the next page
     * @returns {boolean} True if navigation was successful
     */
    nextPage() {
        if (this.currentPage < this.totalPages) {
            this.currentPage++;
            this.triggerPageChange();
            return true;
        }
        return false;
    }

    /**
     * Navigate to the previous page
     * @returns {boolean} True if navigation was successful
     */
    previousPage() {
        if (this.currentPage > 1) {
            this.currentPage--;
            this.triggerPageChange();
            return true;
        }
        return false;
    }

    /**
     * Navigate to a specific page
     * @param {number} pageNumber - Page number to navigate to
     * @returns {boolean} True if navigation was successful
     */
    goToPage(pageNumber) {
        if (pageNumber >= 1 && pageNumber <= this.totalPages) {
            this.currentPage = pageNumber;
            this.triggerPageChange();
            return true;
        }
        return false;
    }

    /**
     * Check if there is a next page available
     * @returns {boolean}
     */
    hasNextPage() {
        return this.currentPage < this.totalPages;
    }

    /**
     * Check if there is a previous page available
     * @returns {boolean}
     */
    hasPreviousPage() {
        return this.currentPage > 1;
    }

    /**
     * Check if pagination is needed (more than one page)
     * @returns {boolean}
     */
    isPaginationNeeded() {
        return this.totalPages > 1;
    }

    /**
     * Get current pagination state
     * @returns {Object} Pagination state
     */
    getState() {
        return {
            currentPage: this.currentPage,
            totalPages: this.totalPages,
            itemsPerPage: this.itemsPerPage,
            totalItems: this.allItems.length,
            hasNext: this.hasNextPage(),
            hasPrevious: this.hasPreviousPage(),
            isPaginationNeeded: this.isPaginationNeeded()
        };
    }

    /**
     * Register a callback to be called when page changes
     * @param {Function} callback - Function to call on page change
     */
    onPageChange(callback) {
        this.onPageChangeCallback = callback;
    }

    /**
     * Trigger the page change callback
     */
    triggerPageChange() {
        if (this.onPageChangeCallback) {
            this.onPageChangeCallback(this.getState());
        }
    }

    /**
     * Reset pagination to initial state
     */
    reset() {
        this.currentPage = 1;
        this.totalPages = 1;
        this.allItems = [];
    }

    /**
     * Get the range of items being displayed
     * @returns {Object} {start, end} indices
     */
    getCurrentRange() {
        const start = (this.currentPage - 1) * this.itemsPerPage + 1;
        const end = Math.min(this.currentPage * this.itemsPerPage, this.allItems.length);
        return { start, end };
    }
}