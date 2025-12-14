// ==UserScript==
// @name         TrafficPoint Logs - Copy Processed Results
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  Extract and copy processed results from TrafficPoint logs as JSON or CSV (only when count > 0)
// @author       Ohad
// @match        https://cms.trafficpointltd.com/reports/logs/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // Add CSS styles
    const style = document.createElement('style');
    style.textContent = `
        .tp-export-container {
            position: fixed;
            top: 10px;
            right: 10px;
            z-index: 9999;
            display: flex;
            gap: 10px;
            background: white;
            padding: 10px;
            border-radius: 5px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.2);
        }
        .tp-export-btn {
            padding: 8px 16px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-weight: bold;
            transition: all 0.3s;
        }
        .tp-export-json {
            background: #4CAF50;
            color: white;
        }
        .tp-export-json:hover {
            background: #45a049;
        }
        .tp-export-csv {
            background: #2196F3;
            color: white;
        }
        .tp-export-csv:hover {
            background: #0b7dda;
        }
        .tp-export-notification {
            position: fixed;
            top: 70px;
            right: 10px;
            background: #333;
            color: white;
            padding: 12px 20px;
            border-radius: 4px;
            z-index: 10000;
            animation: slideIn 0.3s ease-out;
        }
        @keyframes slideIn {
            from {
                transform: translateX(400px);
                opacity: 0;
            }
            to {
                transform: translateX(0);
                opacity: 1;
            }
        }
    `;
    document.head.appendChild(style);

    // Create button container
    const container = document.createElement('div');
    container.className = 'tp-export-container';
    container.innerHTML = `
        <button class="tp-export-btn tp-export-json" id="exportJSON">📋 Copy as JSON</button>
        <button class="tp-export-btn tp-export-csv" id="exportCSV">📊 Copy as CSV</button>
    `;
    document.body.appendChild(container);

    // Function to extract processed results from the page
    function extractProcessedResults() {
        const results = [];

        // Find all table rows
        const rows = document.querySelectorAll('tr[role="row"]');

        let expectingResultsTable = false;
        let expectedCount = 0;

        rows.forEach(row => {
            const messageDiv = row.querySelector('.message');
            if (!messageDiv) return;

            const messageText = messageDiv.textContent.trim();

            // Check if this row contains "Processed results Count: X"
            const countMatch = messageText.match(/"Processed results Count:\s*(\d+)"/);
            if (countMatch) {
                const count = parseInt(countMatch[1]);
                if (count > 0) {
                    expectingResultsTable = true;
                    expectedCount = count;
                } else {
                    expectingResultsTable = false;
                    expectedCount = 0;
                }
                return;
            }

            // If we're expecting a results table, look for it in the next row
            if (expectingResultsTable) {
                const tables = messageDiv.querySelectorAll('.tp-table');

                tables.forEach(table => {
                    const tableRows = table.querySelectorAll('.tp-table-row');
                    if (tableRows.length < 2) return; // Need at least header + 1 data row

                    // Extract headers from first row
                    const headerRow = tableRows[0];
                    const headers = Array.from(headerRow.querySelectorAll('.tp-table-cell'))
                        .map(cell => cell.textContent.trim());

                    // Check if this looks like a processed results table
                    if (headers.includes('date') && headers.includes('token') && headers.includes('event')) {
                        // Extract data rows (skip header)
                        for (let i = 1; i < tableRows.length; i++) {
                            const dataRow = tableRows[i];
                            const cells = dataRow.querySelectorAll('.tp-table-cell');

                            if (cells.length === headers.length) {
                                const rowData = {};
                                headers.forEach((header, index) => {
                                    rowData[header] = cells[index].textContent.trim();
                                });
                                results.push(rowData);
                            }
                        }

                        // Reset the flag after processing
                        expectingResultsTable = false;
                        expectedCount = 0;
                    }
                });
            }
        });

        return results;
    }

    // Function to convert to CSV
    function convertToCSV(data) {
        if (data.length === 0) return '';

        const headers = Object.keys(data[0]);
        const csvRows = [];

        // Add header row
        csvRows.push(headers.join(','));

        // Add data rows
        data.forEach(row => {
            const values = headers.map(header => {
                const value = row[header] || '';
                // Escape quotes and wrap in quotes if contains comma or quotes
                if (value.includes(',') || value.includes('"') || value.includes('\n')) {
                    return `"${value.replace(/"/g, '""')}"`;
                }
                return value;
            });
            csvRows.push(values.join(','));
        });

        return csvRows.join('\n');
    }

    // Function to copy to clipboard
    function copyToClipboard(text) {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
    }

    // Function to show notification
    function showNotification(message) {
        const notification = document.createElement('div');
        notification.className = 'tp-export-notification';
        notification.textContent = message;
        document.body.appendChild(notification);

        setTimeout(() => {
            notification.remove();
        }, 3000);
    }

    // Event listeners
    document.getElementById('exportJSON').addEventListener('click', () => {
        const results = extractProcessedResults();

        if (results.length === 0) {
            showNotification('❌ No processed results found (Count > 0)');
            return;
        }

        const json = JSON.stringify(results, null, 2);
        copyToClipboard(json);
        showNotification(`✅ Copied ${results.length} records as JSON`);
    });

    document.getElementById('exportCSV').addEventListener('click', () => {
        const results = extractProcessedResults();

        if (results.length === 0) {
            showNotification('❌ No processed results found (Count > 0)');
            return;
        }

        const csv = convertToCSV(results);
        copyToClipboard(csv);
        showNotification(`✅ Copied ${results.length} records as CSV`);
    });

    console.log('TrafficPoint Logs Exporter loaded successfully');
})();