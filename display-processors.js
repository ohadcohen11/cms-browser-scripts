// ==UserScript==
// @name         TrafficPoint CMS - Display Processors with n8n Export
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  Display active processors in multiple formats on scraper edit pages with n8n export
// @author       Ohad
// @match        https://cms.trafficpointltd.com/reports/scraper/*/edit
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // Extract variable values from the settings section
    function extractVariables() {
        const vars = {};

        // Extract from input fields
        const fields = [
            'username', 'password', 'start_date_run', 'end_date_run',
            'ioid', 'trxid', 'amount', 'commission_amount', 'currency'
        ];

        fields.forEach(fieldName => {
            const input = document.querySelector(`input[name="${fieldName}"], select[name="${fieldName}"]`);
            if (input) {
                vars[fieldName] = input.value || '';
            }
        });

        return vars;
    }

    // Parse shortcode variables like [var name="xxx"]
    function parseShortcode(value, vars) {
        if (!value) return value;

        // Replace [var name="xxx"] with actual value
        const varPattern = /\[var name="([^"]+)"\]/g;
        return value.replace(varPattern, (match, varName) => {
            return vars[varName] || match;
        });
    }

    // Extract processor data
    function extractProcessors() {
        const processors = [];
        const vars = extractVariables();

        document.querySelectorAll('.processor_row_container').forEach(container => {
            const processorId = container.getAttribute('data-processor_id');

            // Check if processor is active
            const activeCheckbox = container.querySelector('input[name="active"]');
            const isActive = activeCheckbox && activeCheckbox.checked;

            if (!isActive) return; // Skip inactive processors

            const processor = {
                processor_id: processorId,
                active: true
            };

            // Extract all editable fields
            container.querySelectorAll('.editable').forEach(field => {
                const fieldName = field.getAttribute('name');
                let fieldValue = field.getAttribute('data-value');

                // Parse shortcodes
                fieldValue = parseShortcode(fieldValue, vars);

                processor[fieldName] = fieldValue;
            });

            processors.push(processor);
        });

        return processors;
    }

    // ========== n8n CONVERSION FUNCTIONS ==========

    // Parse rule string and extract conditions
    function parseRule(ruleString) {
        if (!ruleString) return { conditions: [], combinator: 'and' };

        const conditions = [];

        // Detect combinator - check if [or] exists, otherwise default to [and]
        const combinator = ruleString.includes('[or]') ? 'or' : 'and';

        // Match [if ...] blocks - with optional "translated" keyword
        // Changed [^"]+ to [^"]* to allow empty values
        const ifPattern = /\[if (?:translated )?col_name="([^"]+)" condition="([^"]+)" value="([^"]*)"\]/g;
        let match;
        while ((match = ifPattern.exec(ruleString)) !== null) {
            conditions.push({
                type: 'simple',
                column: match[1],
                condition: match[2],
                value: match[3]
            });
        }

        // Match [dateCompare ...] blocks
        const datePattern = /\[dateCompare from_format="([^"]+)" col_name="([^"]+)" condition="([^"]+)" value="([^"]+)"\]/g;
        while ((match = datePattern.exec(ruleString)) !== null) {
            conditions.push({
                type: 'date',
                format: match[1],
                column: match[2],
                condition: match[3],
                value: match[4]
            });
        }

        return { conditions, combinator };
    }

    // Convert condition operator to n8n format
    function convertOperator(condition, type = 'string') {
        const operatorMap = {
            '=': { string: 'equals', number: 'equals' },
            '!=': { string: 'notEquals', number: 'notEquals' },
            '>': { number: 'gt', string: 'gt' },
            '>=': { number: 'gte', string: 'gte' },
            '<': { number: 'lt', string: 'lt' },
            '<=': { number: 'lte', string: 'lte' },
            'contains': { string: 'contains' },
            'not contains': { string: 'notContains' }
        };

        return operatorMap[condition]?.[type] || 'equals';
    }

    // Convert date format from PHP to Luxon
    function convertDateFormat(phpFormat) {
        // Use numbered placeholders to avoid any conflicts
        let luxonFormat = phpFormat;

        // Year
        luxonFormat = luxonFormat.replace(/Y/g, '§1§');   // 4-digit year → yyyy
        luxonFormat = luxonFormat.replace(/y/g, '§2§');   // 2-digit year → yy

        // Month
        luxonFormat = luxonFormat.replace(/F/g, '§3§');   // Full month name → MMMM
        luxonFormat = luxonFormat.replace(/M/g, '§4§');   // Short month name → MMM
        luxonFormat = luxonFormat.replace(/m/g, '§5§');   // Month with leading zero → MM
        luxonFormat = luxonFormat.replace(/n/g, '§6§');   // Month without leading zero → M

        // Day
        luxonFormat = luxonFormat.replace(/l/g, '§7§');   // Full day name → EEEE (do before 'd')
        luxonFormat = luxonFormat.replace(/D/g, '§8§');   // Short day name → EEE (do before 'd')
        luxonFormat = luxonFormat.replace(/d/g, '§9§');   // Day with leading zero → dd
        luxonFormat = luxonFormat.replace(/j/g, '§10§');  // Day without leading zero → d

        // Time
        luxonFormat = luxonFormat.replace(/H/g, '§11§');  // 24-hour with leading zero → HH
        luxonFormat = luxonFormat.replace(/G/g, '§12§');  // 24-hour without leading zero → H
        luxonFormat = luxonFormat.replace(/h/g, '§13§');  // 12-hour with leading zero → hh
        luxonFormat = luxonFormat.replace(/g/g, '§14§');  // 12-hour without leading zero → h
        luxonFormat = luxonFormat.replace(/i/g, '§15§');  // Minutes → mm
        luxonFormat = luxonFormat.replace(/s/g, '§16§');  // Seconds → ss
        luxonFormat = luxonFormat.replace(/A/g, '§17§');  // AM/PM uppercase → a
        luxonFormat = luxonFormat.replace(/a/g, '§18§');  // AM/PM lowercase → a

        // Replace all numbered placeholders with actual Luxon format
        luxonFormat = luxonFormat.replace(/§1§/g, 'yyyy');
        luxonFormat = luxonFormat.replace(/§2§/g, 'yy');
        luxonFormat = luxonFormat.replace(/§3§/g, 'MMMM');
        luxonFormat = luxonFormat.replace(/§4§/g, 'MMM');
        luxonFormat = luxonFormat.replace(/§5§/g, 'MM');
        luxonFormat = luxonFormat.replace(/§6§/g, 'M');
        luxonFormat = luxonFormat.replace(/§7§/g, 'EEEE');
        luxonFormat = luxonFormat.replace(/§8§/g, 'EEE');
        luxonFormat = luxonFormat.replace(/§9§/g, 'dd');
        luxonFormat = luxonFormat.replace(/§10§/g, 'd');
        luxonFormat = luxonFormat.replace(/§11§/g, 'HH');
        luxonFormat = luxonFormat.replace(/§12§/g, 'H');
        luxonFormat = luxonFormat.replace(/§13§/g, 'hh');
        luxonFormat = luxonFormat.replace(/§14§/g, 'h');
        luxonFormat = luxonFormat.replace(/§15§/g, 'mm');
        luxonFormat = luxonFormat.replace(/§16§/g, 'ss');
        luxonFormat = luxonFormat.replace(/§17§/g, 'a');
        luxonFormat = luxonFormat.replace(/§18§/g, 'a');

        return luxonFormat;
    }

    // Convert processor value to n8n expression
    function convertValueToN8n(value) {
        if (!value) return 'Empty';

        // Handle [date col_name="X" from_format='...' format="..."] format
        // The regex handles both single and double quotes for from_format
        const dateMatchWithFormat = value.match(/\[date col_name="([^"]+)"(?:\s+from_format=['"]([^'"]+)['"])?(?:\s+format=['"]([^'"]+)['"])?\](.+)?/);
        if (dateMatchWithFormat) {
            const colName = dateMatchWithFormat[1];
            const fromFormat = dateMatchWithFormat[2]; // PHP format from the source
            const outputFormat = dateMatchWithFormat[3]; // PHP format for output (we ignore this)
            const suffix = dateMatchWithFormat[4] || '';

            // Convert PHP format to Luxon format
            let luxonFromFormat = 'M/d/yyyy'; // default
            if (fromFormat) {
                luxonFromFormat = convertDateFormat(fromFormat);
            }

            // Always output as yyyy-MM-dd regardless of the format parameter
            return `={{ DateTime.fromFormat($json['${colName}'], '${luxonFromFormat}').toFormat('yyyy-MM-dd') }}${suffix}`;
        }

        // Handle [strreplace col_name="X" search="Y" replace="Z"] - treat as [translated col_name="X"]
        const strreplaceMatch = value.match(/\[strreplace col_name="([^"]+)" search="[^"]*" replace="[^"]*"\]/g);
        if (strreplaceMatch) {
            let result = value;
            strreplaceMatch.forEach(match => {
                const colName = match.match(/col_name="([^"]+)"/)[1];
                result = result.replace(match, `{{ $json["${colName}"] }}`);
            });

            // If the result contains template syntax, wrap it properly
            if (result.includes('{{')) {
                return '=' + result;
            }
            return result;
        }

        // Handle [translated col_name="X"] format
        const translatedMatch = value.match(/\[translated col_name="([^"]+)"\]/g);
        if (translatedMatch) {
            let result = value;
            translatedMatch.forEach(match => {
                const colName = match.match(/col_name="([^"]+)"/)[1];
                result = result.replace(match, `{{ $json["${colName}"] }}`);
            });

            // If the result contains template syntax, wrap it properly
            if (result.includes('{{')) {
                return '=' + result;
            }
            return result;
        }

        // Handle numeric values
        if (!isNaN(value) && value.trim() !== '') {
            return parseFloat(value);
        }

        // Handle string values
        if (value === 'Empty' || value === '') {
            return 'Empty';
        }

        // If it starts with =, keep it as is
        if (value.startsWith('=')) {
            return value;
        }

        return '=' + value;
    }

    // Convert processor to n8n workflow format
    function convertProcessorToN8n(processor) {
        const processorName = `Rule ${processor.processor_id} ${processor.event || 'Unknown'}`;
        const { conditions, combinator } = parseRule(processor.rule);

        // Generate unique IDs
        const ifNodeId = generateUUID();
        const setNodeId = generateUUID();

        // Build conditions for IF node
        const n8nConditions = conditions.map((cond, index) => {
            if (cond.type === 'simple') {
                return {
                    id: `cond${index + 1}`,
                    leftValue: `={{ $json['${cond.column}'] }}`,
                    rightValue: cond.value,
                    operator: {
                        type: 'string',
                        operation: convertOperator(cond.condition, 'string')
                    }
                };
            } else if (cond.type === 'date') {
                const luxonFormat = convertDateFormat(cond.format);
                const operation = convertOperator(cond.condition, 'number');

                return {
                    id: `cond${index + 1}`,
                    leftValue: `={{ DateTime.fromFormat($json['${cond.column}'], '${luxonFormat}').toMillis() }}`,
                    rightValue: `={{ DateTime.fromFormat('${cond.value}', '${luxonFormat}').toMillis() }}`,
                    operator: {
                        type: 'number',
                        operation: operation
                    }
                };
            }
        });

        // Build assignments for SET node
        const assignments = [];

        // Map processor fields to assignments
        const fieldMappings = [
            { id: 'date', name: 'date', type: 'string', field: 'date' },
            { id: 'token', name: 'token', type: 'string', field: 'token' },
            { id: 'event', name: 'event', type: 'string', field: 'event' },
            { id: 'trxid', name: 'trx_id', type: 'string', field: 'trx_id' },
            { id: 'ioid', name: 'io_id', type: 'string', field: 'io_id' },
            { id: 'commission', name: 'commission_amount', type: 'number', field: 'commission_amount' },
            { id: 'amount', name: 'amount', type: 'number', field: 'amount' },
            { id: 'currency', name: 'currency', type: 'string', field: 'currency' },
            { id: 'parent', name: 'parent_api_call', type: 'string', field: 'parent_api_call' }
        ];

        fieldMappings.forEach(mapping => {
            const value = convertValueToN8n(processor[mapping.field]);
            assignments.push({
                id: mapping.id,
                name: mapping.name,
                type: mapping.type,
                value: value
            });
        });

        // Build n8n workflow
        const workflow = {
            nodes: [
                {
                    parameters: {
                        conditions: {
                            options: {
                                caseSensitive: true,
                                leftValue: "",
                                typeValidation: "loose",
                                version: 1
                            },
                            conditions: n8nConditions,
                            combinator: combinator
                        },
                        options: {
                            looseTypeValidation: true
                        }
                    },
                    id: ifNodeId,
                    name: processorName,
                    type: "n8n-nodes-base.if",
                    typeVersion: 2,
                    position: [-32, -2144]
                },
                {
                    parameters: {
                        assignments: {
                            assignments: assignments
                        },
                        options: {}
                    },
                    id: setNodeId,
                    name: `Set ${processorName}`,
                    type: "n8n-nodes-base.set",
                    typeVersion: 3.4,
                    position: [288, -2144]
                }
            ],
            connections: {
                [processorName]: {
                    main: [
                        [
                            {
                                node: `Set ${processorName}`,
                                type: "main",
                                index: 0
                            }
                        ]
                    ]
                },
                [`Set ${processorName}`]: {
                    main: [[]]
                }
            },
            pinData: {},
            meta: {
                templateCredsSetupCompleted: true,
                instanceId: "9c5bf950bdf744af658b8eaffa2d80ddde1b38a64fd03f51d6b7bbd4491a0d80"
            }
        };

        return workflow;
    }

    // Generate UUID for n8n nodes
    function generateUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    // Convert all processors to a connected n8n workflow
    function convertAllProcessorsToN8n(processors) {
        const nodes = [];
        const connections = {};

        // Starting position
        const startX = 768;
        const ifX = 1024;
        const setX = 1312;
        const filterX = 1584;
        const startY = 208;
        const verticalSpacing = 144;

        // Calculate center Y position
        const centerY = startY;

        // Create Edit Fields node (start)
        const editFieldsId = generateUUID();
        nodes.push({
            parameters: {
                options: {}
            },
            type: "n8n-nodes-base.set",
            typeVersion: 3.4,
            position: [startX, centerY],
            id: editFieldsId,
            name: "Edit Fields"
        });

        // Create connections from Edit Fields
        connections["Edit Fields"] = {
            main: [[]]
        };

        // Create Filter Valid Date Range node (end)
        const filterId = generateUUID();
        nodes.push({
            parameters: {
                conditions: {
                    options: {
                        caseSensitive: true,
                        leftValue: "",
                        typeValidation: "strict",
                        version: 2
                    },
                    conditions: [
                        {
                            id: generateUUID(),
                            leftValue: "={{ new Date($json.date).getTime() >= ($now.day > 5 ? $now.startOf('month').toMillis() : $now.minus({months: 1}).startOf('month').toMillis()) }}",
                            rightValue: "",
                            operator: {
                                type: "boolean",
                                operation: "true",
                                singleValue: true
                            }
                        },
                        {
                            id: generateUUID(),
                            leftValue: "={{ new Date($json.date).getTime() <= $now.plus({days: 2}).startOf('day').toMillis() }}",
                            rightValue: "",
                            operator: {
                                type: "boolean",
                                operation: "true",
                                singleValue: true
                            }
                        }
                    ],
                    combinator: "and"
                },
                options: {}
            },
            type: "n8n-nodes-base.filter",
            typeVersion: 2.2,
            position: [filterX, centerY],
            id: filterId,
            name: "Filter Valid Date Range"
        });

        connections["Filter Valid Date Range"] = {
            main: [[]]
        };

        // Process each processor
        processors.forEach((processor, index) => {
            const processorName = `Rule ${processor.processor_id} ${processor.event || 'Unknown'}`;
            const { conditions, combinator } = parseRule(processor.rule);

            const yPosition = startY + (index - Math.floor(processors.length / 2)) * verticalSpacing;

            // Generate unique IDs
            const ifNodeId = generateUUID();
            const setNodeId = generateUUID();

            // Build conditions for IF node
            const n8nConditions = conditions.map((cond, condIndex) => {
                if (cond.type === 'simple') {
                    return {
                        id: `cond${condIndex + 1}`,
                        leftValue: `={{ $json['${cond.column}'] }}`,
                        rightValue: cond.value,
                        operator: {
                            type: 'string',
                            operation: convertOperator(cond.condition, 'string')
                        }
                    };
                } else if (cond.type === 'date') {
                    const luxonFormat = convertDateFormat(cond.format);
                    const operation = convertOperator(cond.condition, 'number');

                    return {
                        id: `cond${condIndex + 1}`,
                        leftValue: `={{ DateTime.fromFormat($json['${cond.column}'], '${luxonFormat}').toMillis() }}`,
                        rightValue: `={{ DateTime.fromFormat('${cond.value}', '${luxonFormat}').toMillis() }}`,
                        operator: {
                            type: 'number',
                            operation: operation
                        }
                    };
                }
            });

            // Create IF node
            nodes.push({
                parameters: {
                    conditions: {
                        options: {
                            caseSensitive: true,
                            leftValue: "",
                            typeValidation: "loose",
                            version: 1
                        },
                        conditions: n8nConditions,
                        combinator: combinator
                    },
                    options: {
                        looseTypeValidation: true
                    }
                },
                id: ifNodeId,
                name: processorName,
                type: "n8n-nodes-base.if",
                typeVersion: 2,
                position: [ifX, yPosition]
            });

            // Build assignments for SET node
            const assignments = [];
            const fieldMappings = [
                { id: 'date', name: 'date', type: 'string', field: 'date' },
                { id: 'token', name: 'token', type: 'string', field: 'token' },
                { id: 'event', name: 'event', type: 'string', field: 'event' },
                { id: 'trxid', name: 'trx_id', type: 'string', field: 'trx_id' },
                { id: 'ioid', name: 'io_id', type: 'string', field: 'io_id' },
                { id: 'commission', name: 'commission_amount', type: 'number', field: 'commission_amount' },
                { id: 'amount', name: 'amount', type: 'number', field: 'amount' },
                { id: 'currency', name: 'currency', type: 'string', field: 'currency' },
                { id: 'parent', name: 'parent_api_call', type: 'string', field: 'parent_api_call' }
            ];

            fieldMappings.forEach(mapping => {
                const value = convertValueToN8n(processor[mapping.field]);
                assignments.push({
                    id: mapping.id,
                    name: mapping.name,
                    type: mapping.type,
                    value: value
                });
            });

            // Create SET node
            const setNodeName = `Set ${processorName}`;
            nodes.push({
                parameters: {
                    assignments: {
                        assignments: assignments
                    },
                    options: {}
                },
                id: setNodeId,
                name: setNodeName,
                type: "n8n-nodes-base.set",
                typeVersion: 3.4,
                position: [setX, yPosition]
            });

            // Connect Edit Fields -> IF node
            connections["Edit Fields"].main[0].push({
                node: processorName,
                type: "main",
                index: 0
            });

            // Connect IF node -> SET node
            connections[processorName] = {
                main: [[{
                    node: setNodeName,
                    type: "main",
                    index: 0
                }]]
            };

            // Connect SET node -> Filter
            connections[setNodeName] = {
                main: [[{
                    node: "Filter Valid Date Range",
                    type: "main",
                    index: 0
                }]]
            };
        });

        // Build complete workflow
        const workflow = {
            nodes: nodes,
            connections: connections,
            pinData: {},
            meta: {
                templateCredsSetupCompleted: true,
                instanceId: "9c5bf950bdf744af658b8eaffa2d80ddde1b38a64fd03f51d6b7bbd4491a0d80"
            }
        };

        return workflow;
    }

    // Copy processor to n8n format
    function copyProcessorToN8n(processor) {
        try {
            const n8nWorkflow = convertProcessorToN8n(processor);
            const jsonString = JSON.stringify(n8nWorkflow, null, 2);

            return navigator.clipboard.writeText(jsonString).then(() => {
                return { success: true, message: 'Copied to clipboard! You can now paste directly into n8n canvas.' };
            }).catch(err => {
                return { success: false, message: 'Failed to copy: ' + err };
            });
        } catch (err) {
            return Promise.resolve({ success: false, message: 'Conversion error: ' + err.message });
        }
    }

    // ========== END n8n CONVERSION FUNCTIONS ==========

    // Format processors as JSON
    function formatAsJSON(processors) {
        // Add processor name to each processor object for JSON view
        const processorsWithNames = processors.map(proc => ({
            processor_name: `Rule ${proc.processor_id} ${proc.event || 'Unknown'}`,
            ...proc
        }));
        return JSON.stringify(processorsWithNames, null, 2);
    }

    // Format processors as readable text
    function formatAsText(processors) {
        let output = '';

        processors.forEach((proc, index) => {
            const processorName = `Rule ${proc.processor_id} ${proc.event || 'Unknown'}`;

            output += `\n${'='.repeat(80)}\n`;
            output += `PROCESSOR #${index + 1} (ID: ${proc.processor_id}) - ${processorName}\n`;
            output += `${'='.repeat(80)}\n\n`;

            // Display rule (condition) with line breaks
            if (proc.rule) {
                output += `📋 RULE:\n`;
                const formattedRule = proc.rule.replace(/\[and\]/g, '\n    [and]');
                output += `${formattedRule}\n\n`;
            }

            output += `Event: ${proc.event}\n`;
            output += `Date: ${proc.date}\n`;
            output += `Token: ${proc.token}\n`;
            output += `Transaction ID: ${proc.trx_id}\n`;
            output += `IO ID: ${proc.io_id}\n`;
            output += `Commission Amount: ${proc.commission_amount}\n`;
            output += `Amount: ${proc.amount}\n`;
            output += `Currency: ${proc.currency}\n`;
            output += `Parent API Call: ${proc.parent_api_call}\n`;
            output += `Active: ${proc.active}\n`;
        });

        return output;
    }

    // Format processors as Markdown table
    function formatAsMarkdown(processors) {
        let output = '# Active Processors\n\n';

        processors.forEach((proc, index) => {
            const processorName = `Rule ${proc.processor_id} ${proc.event || 'Unknown'}`;

            output += `## Processor ${index + 1} - ${processorName} (ID: ${proc.processor_id})\n\n`;

            if (proc.rule) {
                output += `**Rule:**\n\`\`\`\n`;
                const formattedRule = proc.rule.replace(/\[and\]/g, '\n[and]');
                output += `${formattedRule}\n\`\`\`\n\n`;
            }

            output += '| Field | Value |\n';
            output += '|-------|-------|\n';
            output += `| Event | ${proc.event} |\n`;
            output += `| Date | ${proc.date} |\n`;
            output += `| Token | ${proc.token} |\n`;
            output += `| Transaction ID | ${proc.trx_id} |\n`;
            output += `| IO ID | ${proc.io_id} |\n`;
            output += `| Commission Amount | ${proc.commission_amount} |\n`;
            output += `| Amount | ${proc.amount} |\n`;
            output += `| Currency | ${proc.currency} |\n`;
            output += `| Parent API Call | ${proc.parent_api_call} |\n\n`;
        });

        return output;
    }

    // Format rule with line breaks at [and]
    function formatRuleWithLineBreaks(rule) {
        if (!rule) return rule;
        // Replace [and] with line break for better readability
        return rule.replace(/\[and\]/g, '<br/>⤷ ');
    }

    // Format processors as HTML
    function formatAsHTML(processors) {
        let html = '<div style="font-family: Arial, sans-serif;">';
        html += '<h2 style="color: #2c3e50;">Active Processors</h2>';

        processors.forEach((proc, index) => {
            const processorName = `Rule ${proc.processor_id} ${proc.event || 'Unknown'}`;
            const isReviewed = sessionStorage.getItem(`processor_reviewed_${proc.processor_id}`) === 'true';

            html += `<div id="proc_${proc.processor_id}" style="border: 2px solid #3498db; border-radius: 8px; padding: 15px; margin-bottom: 20px; background-color: ${isReviewed ? '#d4edda' : '#ecf0f1'}; transition: background-color 0.3s ease;">`;

            // Header with processor name and buttons
            html += `<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">`;
            html += `<h3 style="color: #2980b9; margin: 0;">`;
            html += `Processor #${index + 1} <small style="color: #7f8c8d;">(ID: ${proc.processor_id})</small>`;
            html += `</h3>`;
            html += `<div style="display: flex; gap: 10px; align-items: center;">`;
            html += `<span style="font-weight: bold; color: #2c3e50; background: white; padding: 8px 12px; border-radius: 4px; border: 2px solid #3498db;">${processorName}</span>`;
            html += `<button class="copy-proc-name" data-name="${processorName}" style="padding: 6px 12px; background-color: #27ae60; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px;">📋 Copy Name</button>`;
            html += `<button class="copy-to-n8n" data-processor-index="${index}" style="padding: 6px 12px; background-color: #9b59b6; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px;">🔄 Copy to n8n</button>`;
            html += `<button class="toggle-reviewed" data-id="${proc.processor_id}" style="padding: 6px 12px; background-color: ${isReviewed ? '#ffc107' : '#3498db'}; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px;">${isReviewed ? '↩️ Unmark' : '✓ Mark Reviewed'}</button>`;
            html += `</div>`;
            html += `</div>`;

            if (proc.rule) {
                const formattedRule = formatRuleWithLineBreaks(proc.rule);
                html += `<div style="background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 10px; margin-bottom: 15px;">`;
                html += `<strong>📋 Rule:</strong><br/><code style="display: block; margin-top: 8px; line-height: 1.6;">${formattedRule}</code>`;
                html += `</div>`;
            }

            html += '<table style="width: 100%; border-collapse: collapse;">';

            const fields = [
                ['Event', proc.event],
                ['Date', proc.date],
                ['Token', proc.token],
                ['Transaction ID', proc.trx_id],
                ['IO ID', proc.io_id],
                ['Commission Amount', proc.commission_amount],
                ['Amount', proc.amount],
                ['Currency', proc.currency],
                ['Parent API Call', proc.parent_api_call]
            ];

            fields.forEach(([label, value]) => {
                html += `<tr style="border-bottom: 1px solid #bdc3c7;">`;
                html += `<td style="padding: 8px; font-weight: bold; width: 200px;">${label}:</td>`;
                html += `<td style="padding: 8px;"><code>${value}</code></td>`;
                html += `</tr>`;
            });

            html += '</table></div>';
        });

        html += '</div>';
        return html;
    }

    // Create and show modal
    function showProcessorsModal() {
        const processors = extractProcessors();

        if (processors.length === 0) {
            alert('No active processors found on this page.');
            return;
        }

        // Create modal overlay
        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0, 0, 0, 0.7);
            z-index: 10000;
            display: flex;
            justify-content: center;
            align-items: center;
        `;

        // Create modal content
        const modal = document.createElement('div');
        modal.style.cssText = `
            background-color: white;
            width: 90%;
            max-width: 1200px;
            max-height: 90vh;
            border-radius: 8px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
            display: flex;
            flex-direction: column;
        `;

        // Modal header
        const header = document.createElement('div');
        header.style.cssText = `
            padding: 20px;
            border-bottom: 2px solid #e0e0e0;
            display: flex;
            justify-content: space-between;
            align-items: center;
        `;
        header.innerHTML = `
            <h2 style="margin: 0; color: #2c3e50;">Active Processors (${processors.length})</h2>
            <button id="closeModal" style="
                background: #e74c3c;
                color: white;
                border: none;
                padding: 8px 16px;
                border-radius: 4px;
                cursor: pointer;
                font-size: 16px;
            ">✕ Close</button>
        `;

        // Format selector
        const formatSelector = document.createElement('div');
        formatSelector.style.cssText = `
            padding: 15px 20px;
            background-color: #f8f9fa;
            border-bottom: 1px solid #e0e0e0;
        `;
        formatSelector.innerHTML = `
            <label style="margin-right: 10px; font-weight: bold;">Format:</label>
            <select id="formatSelect" style="
                padding: 8px 12px;
                border: 1px solid #ccc;
                border-radius: 4px;
                font-size: 14px;
                cursor: pointer;
            ">
                <option value="html">HTML View</option>
                <option value="json">JSON</option>
                <option value="text">Plain Text</option>
                <option value="markdown">Markdown</option>
            </select>
            <button id="copyBtn" style="
                margin-left: 15px;
                padding: 8px 16px;
                background-color: #27ae60;
                color: white;
                border: none;
                border-radius: 4px;
                cursor: pointer;
                font-size: 14px;
            ">📋 Copy to Clipboard</button>
            <button id="copyAllN8nBtn" style="
                margin-left: 15px;
                padding: 8px 16px;
                background-color: #9b59b6;
                color: white;
                border: none;
                border-radius: 4px;
                cursor: pointer;
                font-size: 14px;
                font-weight: bold;
            ">🔄 Copy All to n8n</button>
        `;

        // Content area
        const content = document.createElement('div');
        content.id = 'processorContent';
        content.style.cssText = `
            padding: 20px;
            overflow: auto;
            flex: 1;
        `;

        // Assemble modal
        modal.appendChild(header);
        modal.appendChild(formatSelector);
        modal.appendChild(content);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        // Display initial format
        const formatSelect = document.getElementById('formatSelect');
        const displayContent = () => {
            const format = formatSelect.value;
            let formattedContent = '';

            switch(format) {
                case 'json':
                    formattedContent = `<pre style="background: #282c34; color: #abb2bf; padding: 15px; border-radius: 4px; overflow-x: auto;">${formatAsJSON(processors)}</pre>`;
                    break;
                case 'text':
                    formattedContent = `<pre style="background: #f4f4f4; padding: 15px; border-radius: 4px; overflow-x: auto; white-space: pre-wrap;">${formatAsText(processors)}</pre>`;
                    break;
                case 'markdown':
                    formattedContent = `<pre style="background: #f4f4f4; padding: 15px; border-radius: 4px; overflow-x: auto; white-space: pre-wrap;">${formatAsMarkdown(processors)}</pre>`;
                    break;
                case 'html':
                default:
                    formattedContent = formatAsHTML(processors);
                    break;
            }

            content.innerHTML = formattedContent;
        };

        displayContent();

        // Event listeners
        formatSelect.addEventListener('change', displayContent);

        // Add event delegation for dynamic buttons
        content.addEventListener('click', (e) => {
            // Copy processor name
            if (e.target.classList.contains('copy-proc-name')) {
                const name = e.target.getAttribute('data-name');
                navigator.clipboard.writeText(name).then(() => {
                    const originalText = e.target.innerHTML;
                    e.target.innerHTML = '✅ Copied!';
                    e.target.style.backgroundColor = '#2ecc71';
                    setTimeout(() => {
                        e.target.innerHTML = originalText;
                        e.target.style.backgroundColor = '#27ae60';
                    }, 1500);
                }).catch(err => {
                    alert('Failed to copy: ' + err);
                });
            }

            // Copy to n8n
            if (e.target.classList.contains('copy-to-n8n')) {
                const processorIndex = parseInt(e.target.getAttribute('data-processor-index'));
                const processor = processors[processorIndex];

                const originalText = e.target.innerHTML;
                const originalBg = e.target.style.backgroundColor;

                e.target.innerHTML = '⏳ Converting...';
                e.target.disabled = true;

                copyProcessorToN8n(processor).then(result => {
                    if (result.success) {
                        e.target.innerHTML = '✅ Copied!';
                        e.target.style.backgroundColor = '#2ecc71';

                        // Show success message
                        const successMsg = document.createElement('div');
                        successMsg.style.cssText = `
                            position: fixed;
                            top: 20px;
                            right: 20px;
                            background: #2ecc71;
                            color: white;
                            padding: 15px 20px;
                            border-radius: 6px;
                            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                            z-index: 10001;
                            font-weight: bold;
                        `;
                        successMsg.textContent = result.message;
                        document.body.appendChild(successMsg);

                        setTimeout(() => {
                            document.body.removeChild(successMsg);
                        }, 3000);
                    } else {
                        e.target.innerHTML = '❌ Failed';
                        e.target.style.backgroundColor = '#e74c3c';
                        alert(result.message);
                    }

                    setTimeout(() => {
                        e.target.innerHTML = originalText;
                        e.target.style.backgroundColor = originalBg;
                        e.target.disabled = false;
                    }, 2000);
                });
            }

            // Toggle reviewed status
            if (e.target.classList.contains('toggle-reviewed')) {
                const procId = e.target.getAttribute('data-id');
                const currentState = sessionStorage.getItem(`processor_reviewed_${procId}`) === 'true';
                const newState = !currentState;

                sessionStorage.setItem(`processor_reviewed_${procId}`, newState.toString());

                // Update UI
                const procDiv = document.getElementById(`proc_${procId}`);
                if (procDiv) {
                    procDiv.style.backgroundColor = newState ? '#d4edda' : '#ecf0f1';
                }

                e.target.style.backgroundColor = newState ? '#ffc107' : '#3498db';
                e.target.innerHTML = newState ? '↩️ Unmark' : '✓ Mark Reviewed';
            }
        });

        document.getElementById('closeModal').addEventListener('click', () => {
            document.body.removeChild(overlay);
        });

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                document.body.removeChild(overlay);
            }
        });

        document.getElementById('copyBtn').addEventListener('click', () => {
            const format = formatSelect.value;
            let textToCopy = '';

            switch(format) {
                case 'json':
                    textToCopy = formatAsJSON(processors);
                    break;
                case 'text':
                    textToCopy = formatAsText(processors);
                    break;
                case 'markdown':
                    textToCopy = formatAsMarkdown(processors);
                    break;
                case 'html':
                    textToCopy = formatAsHTML(processors);
                    break;
            }

            navigator.clipboard.writeText(textToCopy).then(() => {
                const btn = document.getElementById('copyBtn');
                const originalText = btn.innerHTML;
                btn.innerHTML = '✅ Copied!';
                btn.style.backgroundColor = '#2ecc71';
                setTimeout(() => {
                    btn.innerHTML = originalText;
                    btn.style.backgroundColor = '#27ae60';
                }, 2000);
            }).catch(err => {
                alert('Failed to copy to clipboard: ' + err);
            });
        });

        document.getElementById('copyAllN8nBtn').addEventListener('click', () => {
            const btn = document.getElementById('copyAllN8nBtn');
            const originalText = btn.innerHTML;
            const originalBg = btn.style.backgroundColor;

            btn.innerHTML = '⏳ Converting...';
            btn.disabled = true;

            try {
                const n8nWorkflow = convertAllProcessorsToN8n(processors);
                const jsonString = JSON.stringify(n8nWorkflow, null, 2);

                navigator.clipboard.writeText(jsonString).then(() => {
                    btn.innerHTML = '✅ Copied All!';
                    btn.style.backgroundColor = '#2ecc71';

                    // Show success message
                    const successMsg = document.createElement('div');
                    successMsg.style.cssText = `
                        position: fixed;
                        top: 20px;
                        right: 20px;
                        background: #2ecc71;
                        color: white;
                        padding: 15px 20px;
                        border-radius: 6px;
                        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                        z-index: 10001;
                        font-weight: bold;
                    `;
                    successMsg.textContent = `All ${processors.length} processors copied! Paste into n8n canvas.`;
                    document.body.appendChild(successMsg);

                    setTimeout(() => {
                        if (document.body.contains(successMsg)) {
                            document.body.removeChild(successMsg);
                        }
                    }, 3000);

                    setTimeout(() => {
                        btn.innerHTML = originalText;
                        btn.style.backgroundColor = originalBg;
                        btn.disabled = false;
                    }, 2000);
                }).catch(err => {
                    btn.innerHTML = '❌ Failed';
                    btn.style.backgroundColor = '#e74c3c';
                    alert('Failed to copy to clipboard: ' + err);

                    setTimeout(() => {
                        btn.innerHTML = originalText;
                        btn.style.backgroundColor = originalBg;
                        btn.disabled = false;
                    }, 2000);
                });
            } catch (err) {
                btn.innerHTML = '❌ Error';
                btn.style.backgroundColor = '#e74c3c';
                alert('Conversion error: ' + err.message);

                setTimeout(() => {
                    btn.innerHTML = originalText;
                    btn.style.backgroundColor = originalBg;
                    btn.disabled = false;
                }, 2000);
            }
        });
    }

    // Create floating button
    function createButton() {
        const button = document.createElement('button');
        button.innerHTML = '📊 Display Processors';
        button.style.cssText = `
            position: fixed;
            bottom: 20px;
            left: 20px;
            z-index: 9999;
            padding: 12px 20px;
            background-color: #3498db;
            color: white;
            border: none;
            border-radius: 6px;
            font-size: 14px;
            font-weight: bold;
            cursor: pointer;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
            transition: all 0.3s ease;
        `;

        button.addEventListener('mouseenter', () => {
            button.style.backgroundColor = '#2980b9';
            button.style.transform = 'scale(1.05)';
        });

        button.addEventListener('mouseleave', () => {
            button.style.backgroundColor = '#3498db';
            button.style.transform = 'scale(1)';
        });

        button.addEventListener('click', showProcessorsModal);

        document.body.appendChild(button);
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', createButton);
    } else {
        createButton();
    }
})();
