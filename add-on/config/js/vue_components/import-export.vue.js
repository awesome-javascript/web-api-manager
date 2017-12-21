(function () {
    "use strict";

    const {blockRulesLib} = window.WEB_API_MANAGER;
    const Vue = window.Vue;

    /**
     * Checks to make sure the given string is a valid set of data to import
     * as block rules.
     *
     * @param {string} jsonString
     *   A JSON string, describing zero or more DomainBlock rules, in the
     *   format generated by `BlockRule.toJSON`.
     *
     * @return {Object}
     *   An object describing whether the given string was a valid data export,
     *   and whether it can be imported.  If so, the "success" key of the
     *   object will be true, and the "data" key will be an array of BlockRule
     *   objects.  If the string is invalid, the "success" key will be false,
     *   and the "data" key will be a string describing the error.
     */
    const parseImportString = jsonString => {
        let parsedData;

        try {
            parsedData = JSON.parse(jsonString);
        } catch (e) {
            return {success: false, data: e};
        }

        try {
            const rules = parsedData.map(aRuleRaw => {
                return blockRulesLib.fromData(aRuleRaw);
            });
            return {success: true, data: rules};
        } catch (e) {
            return {success: false, data: e};
        }
    };

    const generateExportString = (patternsToExport, preferences) => {
        const ruleData = patternsToExport.map(pattern => {
            return preferences.getRuleForPattern(pattern).toData();
        });
        return JSON.stringify(ruleData);
    };

    Vue.component("import-export", {
        props: ["dataPatterns"],
        render: window.WEB_API_MANAGER.vueComponents["import-export"].render,
        staticRenderFns: window.WEB_API_MANAGER.vueComponents["import-export"].staticRenderFns,
        data: function () {
            return {
                exportedData: "",
                patternsToExport: [],
                importError: false,
                importLog: "",
                importTextAreaValue: "",
                dataToImport: undefined,
                shouldOverwrite: false,
            };
        },
        methods: {
            onImportClicked: function (event) {
                if (!this.isValidToImport()) {
                    this.importError = true;
                    this.dataToImport = undefined;
                    this.importLog = "No data to import.";
                    return;
                }

                const shouldOverwrite = !!this.shouldOverwrite;
                const stateObject = this.$root.$data;
                const preferences = stateObject.preferences;
                const newRules = this.dataToImport;
                this.importLog = "";

                const logMessages = newRules.map(newRule => {
                    const newPattern = newRule.pattern;
                    const currentRule = preferences.getRuleForPattern(newPattern);
                    if (currentRule !== undefined && shouldOverwrite === false) {
                        return ` ! ${newPattern}: Skipped. Set to not override.\n`;
                    }

                    const newStandardIds = newRule.getStandardIds();
                    this.$root.$data.setStandardIdsForPattern(newPattern, newStandardIds);
                    return ` * ${newPattern}: Blocking ${newStandardIds.length} standards.\n`;
                });

                this.importError = false;
                this.importLog = logMessages.join("\n");

                event.stopPropagation();
                event.preventDefault();
            },
            isValidToImport: function () {
                return (this.importError === false) && (this.dataToImport !== undefined);
            },
        },
        watch: {
            selectedStandardIds: function () {
                this.exportedData = generateExportString(
                    this.patternsToExport,
                    this.$root.$data.preferences
                );
            },
            patternsToExport: function (selectedPatterns) {
                this.exportedData = generateExportString(
                    selectedPatterns,
                    this.$root.$data.preferences
                );
            },
            importTextAreaValue: function () {
                const value = this.importTextAreaValue;

                if (value.trim() === "") {
                    this.dataToImport = undefined;
                    this.importError = false;
                    this.importLog = "";
                    return;
                }

                // The provided JSON should be an array of values generated
                // by `BlockRule.toJSON`.
                const {success, data} = parseImportString(value);
                if (success !== true) {
                    this.dataToImport = undefined;
                    this.importError = true;
                    this.importLog = data;
                    return;
                }

                this.dataToImport = data;
                this.importError = false;
                this.importLog = "";
            },
        },
    });
}());
