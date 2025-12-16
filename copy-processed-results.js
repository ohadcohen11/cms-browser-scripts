// ==UserScript==
// @name         TrafficPoint Logs - Copy Processed Results
// @namespace    http://tampermonkey.net/
// @version      1.2
// @description  Extract and copy processed results from TrafficPoint logs as JSON, CSV, or XLSX (only when count > 0)
// @author       Ohad
// @match        https://cms.trafficpointltd.com/reports/logs/*
// @require      https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js
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
        .tp-export-per-processor {
            background: #9C27B0;
            color: white;
        }
        .tp-export-per-processor:hover {
            background: #7B1FA2;
        }
        .tp-export-xlsx {
            background: #FF9800;
            color: white;
        }
        .tp-export-xlsx:hover {
            background: #F57C00;
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
        .tp-processor-modal {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.7);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 10001;
        }
        .tp-processor-modal-content {
            background: white;
            padding: 20px;
            border-radius: 8px;
            max-width: 600px;
            max-height: 80vh;
            overflow-y: auto;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
        }
        .tp-processor-modal-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
            padding-bottom: 10px;
            border-bottom: 2px solid #eee;
        }
        .tp-processor-modal-close {
            background: #e74c3c;
            color: white;
            border: none;
            padding: 5px 10px;
            border-radius: 4px;
            cursor: pointer;
        }
        .tp-processor-item {
            padding: 12px;
            margin: 8px 0;
            border: 1px solid #ddd;
            border-radius: 4px;
            cursor: pointer;
            transition: all 0.2s;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .tp-processor-item:hover {
            background: #f5f5f5;
            border-color: #999;
        }
        .tp-processor-info {
            flex: 1;
        }
        .tp-processor-name {
            font-weight: bold;
            color: #333;
        }
        .tp-processor-count {
            color: #666;
            font-size: 0.9em;
        }
        .tp-processor-buttons {
            display: flex;
            gap: 5px;
        }
        .tp-processor-copy-btn {
            padding: 6px 12px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.85em;
            font-weight: bold;
        }
        .tp-processor-copy-json {
            background: #4CAF50;
            color: white;
        }
        .tp-processor-copy-csv {
            background: #2196F3;
            color: white;
        }
    `;
    document.head.appendChild(style);

    // Create button container
    const container = document.createElement('div');
    container.className = 'tp-export-container';
    container.innerHTML = `
        <button class="tp-export-btn tp-export-json" id="exportJSON">📋 Copy All as JSON</button>
        <button class="tp-export-btn tp-export-csv" id="exportCSV">📊 Copy All as CSV</button>
        <button class="tp-export-btn tp-export-per-processor" id="exportPerProcessor">🔍 Per Processor</button>
        <button class="tp-export-btn tp-export-xlsx" id="exportXLSX">📥 Download Excel</button>
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

    // Function to extract processed results grouped by processor
    function extractProcessedResultsByProcessor() {
        const processorResults = {};

        // Find all table rows
        const rows = Array.from(document.querySelectorAll('tr[role="row"]'));

        let lastCount = 0;
        let lastResultsTable = null;

        rows.forEach((row, rowIndex) => {
            const messageDiv = row.querySelector('.message');
            if (!messageDiv) return;

            const messageText = messageDiv.textContent.trim();

            // Check if this row contains "Processed results Count: X"
            const countMatch = messageText.match(/"Processed results Count:\s*(\d+)"/);
            if (countMatch) {
                lastCount = parseInt(countMatch[1]);
                lastResultsTable = null; // Reset
                return;
            }

            // Look for tables in current row
            const tables = messageDiv.querySelectorAll('.tp-table');
            tables.forEach(table => {
                const tableRows = table.querySelectorAll('.tp-table-row');
                if (tableRows.length < 2) return; // Need at least header + 1 data row

                // Extract headers from first row
                const headerRow = tableRows[0];
                const headers = Array.from(headerRow.querySelectorAll('.tp-table-cell'))
                    .map(cell => cell.textContent.trim());

                // Check if this is a processed results table
                if (headers.includes('date') && headers.includes('token') && headers.includes('event')) {
                    // This is the results table that comes after the count
                    if (lastCount > 0 && !lastResultsTable) {
                        lastResultsTable = {
                            headers: headers,
                            rows: tableRows
                        };
                    }
                }

                // Check if this is a "Processor params:" table
                if (headers.includes('Processor params:')) {
                    // Extract processor info from nested table
                    const processorCell = tableRows[0].querySelectorAll('.tp-table-cell')[1];
                    if (!processorCell) return;

                    const nestedTable = processorCell.querySelector('.tp-table');
                    if (!nestedTable) return;

                    const nestedRows = nestedTable.querySelectorAll('.tp-table-row');
                    if (nestedRows.length < 2) return;

                    // Get headers and data from nested table
                    const nestedHeaders = Array.from(nestedRows[0].querySelectorAll('.tp-table-cell'))
                        .map(cell => cell.textContent.trim());
                    const nestedData = Array.from(nestedRows[1].querySelectorAll('.tp-table-cell'))
                        .map(cell => cell.textContent.trim());

                    // Find processor ID
                    const idIndex = nestedHeaders.indexOf('id');
                    const processorId = idIndex >= 0 ? nestedData[idIndex] : 'Unknown';
                    const processorName = `Processor ${processorId}`;

                    // If we have results to associate with this processor
                    if (lastCount > 0 && lastResultsTable) {
                        // Initialize processor entry
                        if (!processorResults[processorName]) {
                            processorResults[processorName] = {
                                name: processorName,
                                count: lastCount,
                                results: []
                            };
                        }

                        // Extract data rows from the results table (skip header)
                        for (let i = 1; i < lastResultsTable.rows.length; i++) {
                            const dataRow = lastResultsTable.rows[i];
                            const cells = dataRow.querySelectorAll('.tp-table-cell');

                            if (cells.length === lastResultsTable.headers.length) {
                                const rowData = {};
                                lastResultsTable.headers.forEach((header, idx) => {
                                    rowData[header] = cells[idx].textContent.trim();
                                });
                                processorResults[processorName].results.push(rowData);
                            }
                        }

                        // Reset for next processor
                        lastCount = 0;
                        lastResultsTable = null;
                    }
                }
            });
        });

        return processorResults;
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

    // Function to download all processors as XLSX
    function downloadProcessorsAsXLSX() {
        const processorResults = extractProcessedResultsByProcessor();
        const processorList = Object.values(processorResults);

        if (processorList.length === 0) {
            showNotification('❌ No processors with results found (Count > 0)');
            return;
        }

        try {
            // Create a new workbook
            const workbook = XLSX.utils.book_new();

            // Add each processor as a separate sheet
            processorList.forEach(processor => {
                if (processor.results.length === 0) return;

                // Convert results to worksheet
                const worksheet = XLSX.utils.json_to_sheet(processor.results);

                // Sanitize sheet name (Excel has restrictions: max 31 chars, no special chars)
                let sheetName = processor.name.replace(/[:\\\/\?\*\[\]]/g, '_');
                sheetName = sheetName.substring(0, 31);

                // Add worksheet to workbook
                XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
            });

            // Generate filename with timestamp
            const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
            const filename = `TrafficPoint_Processors_${timestamp}.xlsx`;

            // Write and download the file
            XLSX.writeFile(workbook, filename);

            showNotification(`✅ Downloaded ${processorList.length} processor${processorList.length !== 1 ? 's' : ''} as Excel`);
        } catch (error) {
            console.error('Error creating XLSX:', error);
            showNotification('❌ Error creating Excel file: ' + error.message);
        }
    }

    // Function to show processor selection modal
    function showProcessorModal() {
        const processorResults = extractProcessedResultsByProcessor();
        const processorList = Object.values(processorResults);

        if (processorList.length === 0) {
            showNotification('❌ No processors with results found (Count > 0)');
            return;
        }

        // Create modal
        const modal = document.createElement('div');
        modal.className = 'tp-processor-modal';

        const modalContent = document.createElement('div');
        modalContent.className = 'tp-processor-modal-content';

        // Header
        const header = document.createElement('div');
        header.className = 'tp-processor-modal-header';
        header.innerHTML = `
            <h3 style="margin: 0;">Select Processor (${processorList.length} with results)</h3>
            <button class="tp-processor-modal-close">✕ Close</button>
        `;
        modalContent.appendChild(header);

        // Processor list
        processorList.forEach(processor => {
            const item = document.createElement('div');
            item.className = 'tp-processor-item';
            item.innerHTML = `
                <div class="tp-processor-info">
                    <div class="tp-processor-name">${processor.name}</div>
                    <div class="tp-processor-count">${processor.count} result${processor.count !== 1 ? 's' : ''}</div>
                </div>
                <div class="tp-processor-buttons">
                    <button class="tp-processor-copy-btn tp-processor-copy-json" data-processor="${processor.name}">📋 JSON</button>
                    <button class="tp-processor-copy-btn tp-processor-copy-csv" data-processor="${processor.name}">📊 CSV</button>
                </div>
            `;
            modalContent.appendChild(item);

            // Add event listeners for copy buttons
            const jsonBtn = item.querySelector('.tp-processor-copy-json');
            const csvBtn = item.querySelector('.tp-processor-copy-csv');

            jsonBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const json = JSON.stringify(processor.results, null, 2);
                copyToClipboard(json);
                showNotification(`✅ Copied ${processor.results.length} records from "${processor.name}" as JSON`);
                modal.remove();
            });

            csvBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const csv = convertToCSV(processor.results);
                copyToClipboard(csv);
                showNotification(`✅ Copied ${processor.results.length} records from "${processor.name}" as CSV`);
                modal.remove();
            });
        });

        modal.appendChild(modalContent);
        document.body.appendChild(modal);

        // Close button handler
        const closeBtn = header.querySelector('.tp-processor-modal-close');
        closeBtn.addEventListener('click', () => modal.remove());

        // Click outside to close
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
            }
        });
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

    document.getElementById('exportPerProcessor').addEventListener('click', () => {
        showProcessorModal();
    });

    document.getElementById('exportXLSX').addEventListener('click', () => {
        downloadProcessorsAsXLSX();
    });

    console.log('TrafficPoint Logs Exporter loaded successfully');
})();