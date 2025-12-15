// ==UserScript==
// @name         Scraper Activity Checker
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  Check scraper activity by analyzing processed results count with Excel export
// @author       Ohad
// @match        https://cms.trafficpointltd.com/reports/scraper/*/edit
// @require      https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @connect      cms.trafficpointltd.com
// ==/UserScript==

(function() {
    'use strict';

    const scraperIds = [
        "560", "566", "1104", "1148", "1204", "1218", "1358", "1401", "1408", "1421",
        "1443", "1469", "1500", "1523", "1553", "1555", "1556", "1585", "1592", "1596",
        "1601", "1624", "1676", "1692"
    ];

    // Add styles for the UI
    GM_addStyle(`
        #scraperCheckerBtn {
            position: fixed;
            top: 10px;
            right: 10px;
            z-index: 10000;
            padding: 10px 20px;
            background: #4CAF50;
            color: white;
            border: none;
            border-radius: 5px;
            cursor: pointer;
            font-size: 14px;
            font-weight: bold;
        }
        #scraperCheckerBtn:hover {
            background: #45a049;
        }
        #scraperCheckerBtn.checking {
            background: #2196F3;
            animation: pulse 1.5s ease-in-out infinite;
        }
        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.7; }
        }
        #scraperReport {
            position: fixed;
            top: 60px;
            right: 10px;
            width: 400px;
            max-height: 80vh;
            overflow-y: auto;
            background: white;
            border: 2px solid #333;
            border-radius: 5px;
            padding: 15px;
            z-index: 10000;
            box-shadow: 0 4px 6px rgba(0,0,0,0.3);
            font-family: Arial, sans-serif;
        }
        #scraperReport h3 {
            margin-top: 0;
            color: #333;
        }
        #scraperReport .summary {
            background: #f0f0f0;
            padding: 10px;
            margin-bottom: 15px;
            border-radius: 3px;
        }
        #scraperReport .scraper-item {
            padding: 8px;
            margin: 5px 0;
            border-left: 4px solid #ddd;
            background: #fafafa;
        }
        #scraperReport .active {
            border-left-color: #4CAF50;
        }
        #scraperReport .inactive {
            border-left-color: #f44336;
        }
        #scraperReport .status {
            font-weight: bold;
        }
        #scraperReport .status.active {
            color: #4CAF50;
        }
        #scraperReport .status.inactive {
            color: #f44336;
        }
        #scraperReport .close-btn {
            float: right;
            cursor: pointer;
            font-size: 20px;
            color: #666;
        }
        #scraperReport .progress {
            margin: 10px 0;
            font-style: italic;
            color: #666;
        }
        #scraperReport .download-btn {
            width: 100%;
            padding: 10px;
            margin-top: 15px;
            background: #FF9800;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-weight: bold;
            font-size: 14px;
        }
        #scraperReport .download-btn:hover {
            background: #F57C00;
        }
        #scraperReport .details {
            font-size: 11px;
            color: #666;
            margin-top: 3px;
        }
    `);

    // Create button
    const button = document.createElement('button');
    button.id = 'scraperCheckerBtn';
    button.textContent = 'Check All Scrapers';
    document.body.appendChild(button);

    let isChecking = false;
    let currentResults = null;

    button.addEventListener('click', function() {
        if (isChecking) {
            // If checking is in progress, reopen the popup to show progress
            let reportDiv = document.getElementById('scraperReport');
            if (!reportDiv) {
                reportDiv = document.createElement('div');
                reportDiv.id = 'scraperReport';
                document.body.appendChild(reportDiv);
                reportDiv.innerHTML = '<span class="close-btn" onclick="this.parentElement.remove()">×</span><h3>Scraper Activity Report</h3><div class="progress">Processing...</div>';
            }
        } else if (currentResults) {
            // If we have results, show them again
            let reportDiv = document.getElementById('scraperReport');
            if (!reportDiv) {
                displayReport(currentResults);
            }
        } else {
            // Start new check
            startScraperCheck();
        }
    });

    async function startScraperCheck() {
        isChecking = true;
        currentResults = null;
        button.disabled = false; // Keep button enabled so user can click to reopen
        button.classList.add('checking');
        button.textContent = `Checking (0/${scraperIds.length})...`;

        // Create or recreate report container
        let reportDiv = document.getElementById('scraperReport');
        if (reportDiv) {
            reportDiv.remove();
        }
        reportDiv = document.createElement('div');
        reportDiv.id = 'scraperReport';
        document.body.appendChild(reportDiv);

        reportDiv.innerHTML = '<span class="close-btn" onclick="this.parentElement.remove()">×</span><h3>Scraper Activity Report</h3><div class="progress">Starting...</div>';

        const results = {
            active: [],
            inactive: [],
            errors: [],
            allResults: []
        };

        for (let i = 0; i < scraperIds.length; i++) {
            const scraperId = scraperIds[i];

            // Update button text with progress
            button.textContent = `Checking (${i + 1}/${scraperIds.length})...`;

            // Update progress - recreate div if it was closed
            let progress = document.querySelector('#scraperReport .progress');
            if (!progress) {
                // Report was closed, recreate it
                reportDiv = document.getElementById('scraperReport');
                if (!reportDiv) {
                    reportDiv = document.createElement('div');
                    reportDiv.id = 'scraperReport';
                    document.body.appendChild(reportDiv);
                    reportDiv.innerHTML = '<span class="close-btn" onclick="this.parentElement.remove()">×</span><h3>Scraper Activity Report</h3><div class="progress">Processing...</div>';
                }
                progress = document.querySelector('#scraperReport .progress');
            }

            if (progress) {
                progress.textContent = `Checking scraper ${scraperId} (${i + 1}/${scraperIds.length})...`;
            }

            try {
                const scraperData = await checkScraper(scraperId);
                results.allResults.push(scraperData);
                if (scraperData.isActive) {
                    results.active.push(scraperData);
                } else {
                    results.inactive.push(scraperData);
                }
            } catch (error) {
                const errorData = { scraperId, error: error.message, isActive: false, lastProcessedDate: null, totalProcessed: 0, logsChecked: 0, pagesChecked: 0 };
                results.errors.push(errorData);
                results.allResults.push(errorData);
            }

            // Small delay to avoid overwhelming the server
            await sleep(500);
        }

        currentResults = results;
        isChecking = false;
        button.classList.remove('checking');
        displayReport(results);
        button.textContent = 'View Report';
    }

    async function checkScraper(scraperId) {
        // Fetch the scraper edit page to get pagination info
        const editPageHtml = await fetchPage(`https://cms.trafficpointltd.com/reports/scraper/${scraperId}/edit`);

        // Parse the HTML
        const parser = new DOMParser();
        const doc = parser.parseFromString(editPageHtml, 'text/html');

        // Get total pages from pagination
        const paginationTotal = doc.querySelector('.pagination-panel-total');
        const totalPages = paginationTotal ? parseInt(paginationTotal.textContent) || 1 : 1;

        let isActive = false;
        let lastProcessedDate = null;
        let lastProcessedCount = 0;
        let pagesChecked = 0;

        // Check each page
        for (let page = 1; page <= totalPages && !isActive; page++) {
            pagesChecked++;

            // Fetch logs page
            const logsUrl = `https://cms.trafficpointltd.com/reports/scraper/${scraperId}/logs?page=${page}`;
            const pageHtml = page === 1 ? editPageHtml : await fetchPage(logsUrl);
            const pageDoc = page === 1 ? doc : parser.parseFromString(pageHtml, 'text/html');

            // Find all log entries in the table
            const logRows = pageDoc.querySelectorAll('tr[role="row"]');

            for (let row of logRows) {
                const messageDiv = row.querySelector('.message');
                if (!messageDiv) continue;

                const text = messageDiv.textContent.trim();
                const match = text.match(/"Processed results Count:\s*(\d+)"/);

                if (match) {
                    const count = parseInt(match[1]);

                    if (count > 0) {
                        // Found processed results!
                        isActive = true;
                        lastProcessedCount = count;

                        // Extract date from the row
                        const dateCell = row.querySelector('td:first-child');
                        if (dateCell) {
                            lastProcessedDate = dateCell.textContent.trim();
                        }

                        // Found what we need, stop searching
                        break;
                    }
                }
            }

            if (isActive) break;

            // Small delay between page fetches
            if (page < totalPages) {
                await sleep(300);
            }
        }

        return {
            scraperId,
            isActive,
            lastProcessedDate,
            lastProcessedCount,
            totalPages,
            pagesChecked
        };
    }

    function fetchPage(url) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: url,
                onload: function(response) {
                    if (response.status === 200) {
                        resolve(response.responseText);
                    } else {
                        reject(new Error(`HTTP ${response.status}`));
                    }
                },
                onerror: function(error) {
                    reject(error);
                },
                ontimeout: function() {
                    reject(new Error('Timeout'));
                }
            });
        });
    }

    function displayReport(results) {
        const totalActive = results.active.length;
        const totalInactive = results.inactive.length;
        const totalProcessed = results.active.reduce((sum, item) => sum + item.totalProcessed, 0);

        // Ensure report div exists (recreate if it was closed)
        let reportDiv = document.getElementById('scraperReport');
        if (!reportDiv) {
            reportDiv = document.createElement('div');
            reportDiv.id = 'scraperReport';
            document.body.appendChild(reportDiv);
        }

        let html = `
            <span class="close-btn" onclick="this.parentElement.remove()">×</span>
            <h3>Scraper Activity Report</h3>
            <div class="summary">
                <strong>Total Scrapers:</strong> ${scraperIds.length}<br>
                <strong>Active:</strong> <span style="color: #4CAF50;">${totalActive}</span><br>
                <strong>Inactive:</strong> <span style="color: #f44336;">${totalInactive}</span><br>
                <strong>Total Processed:</strong> ${totalProcessed}<br>
                ${results.errors.length > 0 ? `<strong>Errors:</strong> ${results.errors.length}<br>` : ''}
            </div>
        `;

        if (results.active.length > 0) {
            html += '<h4 style="color: #4CAF50;">Active Scrapers:</h4>';
            results.active.forEach(item => {
                html += `
                    <div class="scraper-item active">
                        <strong>Scraper ${item.scraperId}</strong>
                        <span class="status active">ACTIVE</span><br>
                        Processed: ${item.totalProcessed} | Logs Checked: ${item.logsChecked}
                    </div>
                `;
            });
        }

        if (results.inactive.length > 0) {
            html += '<h4 style="color: #f44336;">Inactive Scrapers:</h4>';
            results.inactive.forEach(item => {
                html += `
                    <div class="scraper-item inactive">
                        <strong>Scraper ${item.scraperId}</strong>
                        <span class="status inactive">INACTIVE</span><br>
                        Processed: ${item.totalProcessed} | Logs Checked: ${item.logsChecked}
                    </div>
                `;
            });
        }

        if (results.errors.length > 0) {
            html += '<h4 style="color: #ff9800;">Errors:</h4>';
            results.errors.forEach(item => {
                html += `
                    <div class="scraper-item" style="border-left-color: #ff9800;">
                        <strong>Scraper ${item.scraperId}</strong><br>
                        Error: ${item.error}
                    </div>
                `;
            });
        }

        reportDiv.innerHTML = html;
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

})();