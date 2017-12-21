/*global sjcl*/
(function () {
    "use strict";
    const {preferencesLib, constants, messagesLib} = window.WEB_API_MANAGER;
    const {cookieEncodingLib, proxyBlockLib, httpHeadersLib} = window.WEB_API_MANAGER;
    const {standardsLib, browserLib} = window.WEB_API_MANAGER;
    const rootObject = browserLib.getRootObject();

    preferencesLib.load(loadedPrefs => {
        messagesLib.register(loadedPrefs);
    });

    // Manage the state of the browser activity, by displaying the number
    // of origins / frames
    const updateBrowserActionBadge = activeInfo => {
        const tabId = activeInfo.tabId;
        rootObject.tabs.executeScript(
            tabId,
            {
                allFrames: true,
                code: "window.location.host",
            },
            allHosts => {
                if (rootObject.runtime.lastError && !allHosts) {
                    rootObject.browserAction.setBadgeText({text: "-"});
                    return;
                }

                const numFrames = allHosts
                    ? Array.from(new Set(allHosts)).length.toString()
                    : "-";

                rootObject.browserAction.setBadgeText({
                    text: numFrames,
                    tabId: tabId,
                });
            }
        );
    };

    rootObject.windows.onFocusChanged.addListener(updateBrowserActionBadge);
    rootObject.tabs.onUpdated.addListener(updateBrowserActionBadge);
    rootObject.tabs.onActivated.addListener(updateBrowserActionBadge);

    const requestFilter = {
        urls: ["<all_urls>"],
        types: ["main_frame", "sub_frame"],
    };

    const cookieRemoverRegex = new RegExp(constants.cookieName + "=.*?;");

    // Make sure we never send the cookie value that contains what
    // standards should be blocked to any server, anytime.  In the common
    // case this will be a NOOP (since the cookie is deleted after being
    // read), but there are some inconsistency / timing situations where
    // making multiple, simultaneous requests to the same domain where
    // we might make a request before deleting the cookie, so the below
    // adds at least some (uncertain) extra protection.
    rootObject.webRequest.onBeforeSendHeaders.addListener(details => {
        const newHeaders = details.requestHeaders.map(header => {
            if (header.name.indexOf("Cookie") === -1) {
                return header;
            }

            const cookieValue = header.value;
            header.value = cookieValue.replace(cookieRemoverRegex, "").trim();
            return header;
        });

        return {
            requestHeaders: newHeaders,
        };
    }, requestFilter, ["blocking", "requestHeaders"]);

    // Inject the blocking settings for each visited domain / frame.
    // This needs to be done synchronously, so that the DOM of the visited
    // page can be instrumented at "document_start" time.  This means we
    // can't do any of the "obvious" techniques for loading the "what should"
    // be blocked in this frame" information (ie using the storage API).
    // So, instead, we halt at the http query point, match the domain being
    // loaded against the current rule set, pack the set of standards
    // that should be blocked into a base64 encoded bitfield, and then
    // push that to the page as a cookie.
    //
    // The page then reads the information about what standards to block
    // out of the cookie (by decoding and unpacking the bitfield), and then
    // deletes the cookie, so nothing is left behind.
    rootObject.webRequest.onHeadersReceived.addListener(details => {
        // In rare cases, the browser might make the first request before
        // its loaded the settings for the extension.  If thats the case, there
        // is nothing meaningful we can do, other than try again next time.
        const prefs = preferencesLib.get();
        if (prefs === undefined) {
            return;
        }

        // Decide which set of blocking rules to use, depending on the host
        // of the URL being requested.
        const url = details.url;
        const matchingRule = prefs.getRuleForUrl(url);
        const standardIdsToBlock = matchingRule.getStandardIds();
        const shouldLog = prefs.getShouldLog();

        const randBytes = sjcl.random.randomWords(4);
        const randNonce = sjcl.codec.base64.fromBits(randBytes);
        const encodedOptions = cookieEncodingLib.toCookieValue(
            standardIdsToBlock,
            shouldLog,
            randNonce
        );

        rootObject.cookies.set({
            url,
            name: constants.cookieName,
            value: encodedOptions,
        });

        // If there are no standards to block on this domain, then there is
        // no need to modify the CSP headers, since no script will be injected
        // into the page.
        if (standardIdsToBlock.length === 0) {
            return;
        }

        // If we're on a site thats sending the "strict-dynamic"
        // Content-Security-Policy instruction, then we need to add the
        // injected proxy code to the list of scripts that are allowed to
        // run in the page.
        const cspDynamicPolicyHeaders = details.responseHeaders
            .filter(httpHeadersLib.isHeaderCSPScriptSrcWithOutUnsafeInline);

        if (cspDynamicPolicyHeaders.length === 1) {
            const [ignore, scriptHash] = proxyBlockLib.generateScriptPayload(
                standardsLib.allStandardIds(),
                standardIdsToBlock,
                shouldLog
            );

            const newCSPValue = httpHeadersLib.createCSPInstructionWithHashAllowed(
                cspDynamicPolicyHeaders[0].value,
                "sha256-" + scriptHash
            );

            if (newCSPValue !== false) {
                cspDynamicPolicyHeaders[0].value = newCSPValue;
            }
        }

        return {
            responseHeaders: details.responseHeaders,
        };
    }, requestFilter, ["blocking", "responseHeaders"]);
}());