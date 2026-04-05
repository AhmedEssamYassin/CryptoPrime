// Global strict mode
"use strict";

// Imports
import { PaginationController } from './pagination-controller.js';
import { PrimeClient } from './prime-client.js';

// DOM elements
const DOM = {
    form: document.getElementById("prime-form"),
    inputs: {
        digitLength: document.getElementById("digit-length"),
        primeCount: document.getElementById("prime-count"),
    },
    errors: {
        form: document.getElementById("error-message"),
        digitLength: document.getElementById("digit-length-error"),
        primeCount: document.getElementById("prime-count-error"),
    },
    ui: {
        loading: document.getElementById("loading"),
        generateButton: document.getElementById("generate-btn"),
        output: document.getElementById("prime-output"),
        resultsHeader: document.getElementById("results-header"),
        exportButton: document.getElementById("export-btn"),
        timeDisplay: document.getElementById("time-display"),
        pagination: document.getElementById("pagination"),
        pageInfo: document.getElementById("page-info"),
        prevButton: document.getElementById("prev-page"),
        nextButton: document.getElementById("next-page"),
    }
};

class CryptoPrime {
    constructor() {
        // Validation configuration
        this.VALIDATION_RULES = {
            digitLength: {
                min: 1,
                max: 500,
                errorMessage: "Please enter a valid digit length (1 - 500)!"
            },
            primeCount: {
                min: 1,
                max: 100,
                errorMessage: "Please enter a valid prime count (1 - 100)!"
            }
        };

        this.VALIDATION_DELAY = 300;

        // Initialize pagination module
        this.pagination = new PaginationController(5); // 5 items per page

        // State management
        this.generationTime = 0;

        // Bind methods to preserve 'this' context
        this.handlePrimeGeneration = this.handlePrimeGeneration.bind(this);
        this.exportPrimes = this.exportPrimes.bind(this);
        this.handlePaginationChange = this.handlePaginationChange.bind(this);
    }

    setupEventListeners() {
        // Individual validation handlers
        const validateDigitLength = this.debounce(() => {
            this.validateInput(DOM.inputs.digitLength, DOM.errors.digitLength, this.VALIDATION_RULES.digitLength);
        }, this.VALIDATION_DELAY);

        const validatePrimeCount = this.debounce(() => {
            this.validateInput(DOM.inputs.primeCount, DOM.errors.primeCount, this.VALIDATION_RULES.primeCount);
        }, this.VALIDATION_DELAY);

        // Input validation listeners
        DOM.inputs.digitLength.addEventListener('input', validateDigitLength);

        DOM.inputs.primeCount.addEventListener('input', validatePrimeCount);

        // Form submission listeners
        DOM.ui.generateButton.addEventListener('click', (event) => {
            event.preventDefault();
            this.handlePrimeGeneration();
        });

        DOM.form.addEventListener('submit', (event) => {
            event.preventDefault();
            this.handlePrimeGeneration();
        });

        // Export button listener
        DOM.ui.exportButton.addEventListener('click', this.exportPrimes);

        // Pagination listeners
        DOM.ui.prevButton.addEventListener('click', () => {
            this.pagination.previousPage();
        });

        DOM.ui.nextButton.addEventListener('click', () => {
            this.pagination.nextPage();
        });

        // Register pagination callback
        this.pagination.onPageChange(this.handlePaginationChange);
    }

    init() {
        this.setupEventListeners();
    }

    // Helper functions for error display
    showValidationError(inputElement, errorElement, message) {
        errorElement.textContent = message;
        errorElement.style.display = "block";
        inputElement.classList.add("show-invalid");
        inputElement.setAttribute("aria-invalid", "true");
        inputElement.setAttribute("aria-describedby", errorElement.id);
    }

    clearValidationError(inputElement, errorElement) {
        errorElement.style.display = "none";
        inputElement.classList.remove("show-invalid");
        inputElement.removeAttribute("aria-invalid");
        inputElement.removeAttribute("aria-describedby");
    }

    // Validation function
    validateInput(inputElement, errorElement, rules) {
        const value = inputElement.value.trim();

        // Clear previous error state
        this.clearValidationError(inputElement, errorElement);

        // Empty input - no error shown until form submission
        if (value === "") {
            return { isValid: false, isEmpty: true };
        }

        // Check for leading zeros
        if (value.startsWith('0')) {
            this.showValidationError(inputElement, errorElement, "Number cannot start with zero!");
            return { isValid: false, isEmpty: false };
        }

        // Parse as number
        const numValue = parseInt(value, 10);

        // Check if it's a valid number
        if (isNaN(numValue) || !Number.isInteger(numValue)) {
            this.showValidationError(inputElement, errorElement, "Please enter a valid integer number!");
            return { isValid: false, isEmpty: false };
        }

        // Check range
        if (numValue < rules.min || numValue > rules.max) {
            this.showValidationError(inputElement, errorElement, rules.errorMessage);
            return { isValid: false, isEmpty: false };
        }

        return { isValid: true, isEmpty: false, value: numValue };
    }

    // Debounced validation to avoid excessive validation calls
    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    // Form validation before submission
    validateForm() {
        const digitLengthValidation = this.validateInput(
            DOM.inputs.digitLength,
            DOM.errors.digitLength,
            this.VALIDATION_RULES.digitLength
        );

        const primeCountValidation = this.validateInput(
            DOM.inputs.primeCount,
            DOM.errors.primeCount,
            this.VALIDATION_RULES.primeCount
        );

        // Handle empty fields at form submission
        if (digitLengthValidation.isEmpty) {
            this.showValidationError(DOM.inputs.digitLength, DOM.errors.digitLength, "Digit length is required!");
        }

        if (primeCountValidation.isEmpty) {
            this.showValidationError(DOM.inputs.primeCount, DOM.errors.primeCount, "Prime count is required!");
        }

        const isFormValid = digitLengthValidation.isValid && primeCountValidation.isValid;

        return {
            isValid: isFormValid,
            values: isFormValid ? {
                digitLength: digitLengthValidation.value,
                primeCount: primeCountValidation.value
            } : null
        };
    }

    // Handle pagination state changes
    handlePaginationChange(state) {
        // Update display with current page items
        this.displayPrimes(this.pagination.getCurrentPageItemsWithIndices());

        // Update pagination UI
        this.updatePaginationUI(state);
    }

    // Display primes on the page
    displayPrimes(itemsWithIndices) {
        // Clear previous results
        DOM.ui.output.innerHTML = "";

        // Add each prime to the output
        itemsWithIndices.forEach(({ item: prime, globalIndex }) => {
            const primeElement = document.createElement("div");
            primeElement.className = "prime-number";
            primeElement.innerHTML = `<strong>Prime ${globalIndex + 1}:</strong> ${prime.toString()}`;

            // Add click-to-copy functionality
            primeElement.addEventListener("click", () => {
                navigator.clipboard.writeText(prime.toString()).then(() => {
                    const originalText = primeElement.innerHTML;
                    primeElement.innerHTML = `<strong>Prime ${globalIndex + 1}:</strong> ${prime.toString()} <em>(Copied!)</em>`;
                    setTimeout(() => {
                        primeElement.innerHTML = originalText;
                    }, 2000);
                }).catch(() => {
                    // Fallback for browsers that don't support clipboard API
                    const textArea = document.createElement("textarea");
                    textArea.value = prime.toString();
                    document.body.appendChild(textArea);
                    textArea.select();
                    document.execCommand('copy');
                    document.body.removeChild(textArea);
                });
            });

            DOM.ui.output.appendChild(primeElement);
        });

        // Show results
        DOM.ui.resultsHeader.style.display = "flex";
        DOM.ui.output.style.display = "block";
    }

    // Update pagination UI elements
    updatePaginationUI(state) {
        if (!state.isPaginationNeeded) {
            DOM.ui.pagination.style.display = "none";
            return;
        }

        DOM.ui.pagination.style.display = "flex";
        DOM.ui.pageInfo.textContent = `Page ${state.currentPage} of ${state.totalPages}`;

        // Update button states
        DOM.ui.prevButton.disabled = !state.hasPrevious;
        DOM.ui.nextButton.disabled = !state.hasNext;
    }

    // Export primes to text file
    exportPrimes() {
        const allPrimes = this.pagination.allItems;

        if (allPrimes.length === 0) return;

        const content = allPrimes.map((prime, idx) => `Prime ${idx + 1}: ${prime.toString()}`).join('\n');

        const header = `CryptoPrime Generator\nGenerated: ${new Date().toLocaleString()}\nTotal Primes: ${allPrimes.length}\nDigit Length: ${DOM.inputs.digitLength.value}\nGeneration Time: ${this.generationTime.toFixed(2)} seconds\n${'='.repeat(50)}\n\n`;

        const blob = new Blob([header + content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${DOM.inputs.primeCount.value}_primes.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    async handlePrimeGeneration() {
        // Validate form
        const formValidation = this.validateForm();

        if (!formValidation.isValid) {
            return; // Stop if validation fails
        }

        // Reset pagination and clear previous results
        this.pagination.reset();
        DOM.ui.output.innerHTML = "";
        DOM.ui.output.style.display = "none";
        DOM.ui.resultsHeader.style.display = "none";
        DOM.errors.form.style.display = "none";
        DOM.ui.exportButton.style.display = "none";
        DOM.ui.timeDisplay.style.display = "none";
        DOM.ui.pagination.style.display = "none";

        // Get input values
        const { digitLength, primeCount } = formValidation.values;

        // Show loading animation
        DOM.ui.loading.style.display = "block";

        // Start timer
        const startTime = performance.now();

        // Generate primes asynchronously with progressive display
        try {
            this.primeClient = new PrimeClient({ mode: 'auto' });

            // Generate primes with callback for progressive updates
            await this.primeClient.generatePrimesProgressive(
                digitLength,
                primeCount,
                (prime) => {
                    // Add prime to pagination
                    this.pagination.addItem(prime);

                    // If we're on the first page, update display immediately
                    const state = this.pagination.getState();
                    if (state.currentPage === 1 && this.pagination.allItems.length <= this.pagination.itemsPerPage) {
                        this.displayPrimes(this.pagination.getCurrentPageItemsWithIndices());
                        this.updatePaginationUI(state);
                    } else {
                        // Just update pagination info
                        this.updatePaginationUI(state);
                    }
                }
            );

            // End timer
            const endTime = performance.now();
            this.generationTime = (endTime - startTime) / 1000;

            // Hide loading animation
            DOM.ui.loading.style.display = "none";

            // Display final results (in case not all were shown progressively)
            const finalState = this.pagination.getState();
            this.displayPrimes(this.pagination.getCurrentPageItemsWithIndices());
            this.updatePaginationUI(finalState);

            // Show time taken
            DOM.ui.timeDisplay.textContent = `Generation completed in ${this.generationTime.toFixed(2)} seconds`;
            DOM.ui.timeDisplay.style.display = "block";

            // Show export button
            DOM.ui.exportButton.style.display = "inline-block";

        } catch (error) {
            DOM.ui.loading.style.display = "none";
            DOM.errors.form.innerText = "Error generating primes: " + error.message;
            DOM.errors.form.style.display = "block";
        }
    }
}

// Initialize the application
document.addEventListener('DOMContentLoaded', function () {
    const app = new CryptoPrime();
    app.init();
});