// const CATCH_SEARCH_ONLY = true;
(function () {
    const _log = console.log;
    _log("start search.js");
    const CATCH_SEARCH_DEBUG = false;
    const filter = new Set();

    // 拦截JSON.parse 分析内容
    const _JSONparse = JSON.parse;
    JSON.parse = function () {
        let data = _JSONparse.apply(this, arguments);
        findMedia(data);
        return data;
    }
    JSON.parse.toString = function () {
        return _JSONparse.toString();
    }

    async function findMedia(data, depth = 0) {
        CATCH_SEARCH_DEBUG && _log(data);
        let index = 0;
        if (!data) { return; }
        if (data instanceof Array && data.length == 16) {
            const isKey = data.every(function (value) {
                return typeof value == 'number' && value <= 256
            });
            if (isKey) {
                postData({ action: "catCatchAddKey", key: data, href: location.href, ext: "key" });
                return;
            }
        }
        for (let key in data) {
            if (index != 0) { depth = 0; } index++;
            if (typeof data[key] == "object") {
                // 查找疑似key
                if (data[key] instanceof Array && data[key].length == 16) {
                    const isKey = data[key].every(function (value) {
                        return typeof value == 'number' && value <= 256
                    });
                    isKey && postData({ action: "catCatchAddKey", key: data[key], href: location.href, ext: "key" });
                    continue;
                }
                if (depth > 10) { continue; }  // 防止死循环 最大深度
                findMedia(data[key], ++depth);
                continue;
            }
            if (typeof data[key] == "string") {
                if (isUrl(data[key])) {
                    let ext = getExtension(data[key]);
                    ext && postData({ action: "catCatchAddMedia", url: data[key], href: location.href, ext: ext });
                    continue;
                }
                if (data[key].substring(0, 7).toUpperCase() == "#EXTM3U") {
                    isFullM3u8(data[key]) && toUrl(data[key]);
                    continue;
                }
                if (data[key].substring(0, 17).toLowerCase() == "data:application/") {
                    const text = getDataM3U8(data[key].substring(17));
                    text && toUrl(text);
                    continue;
                }
                if (data[key].toLowerCase().includes("urn:mpeg:dash:schema:mpd")) {
                    toUrl(data[key], "mpd");
                    continue;
                }
                if (CATCH_SEARCH_DEBUG && data[key].includes("manifest")) {
                    _log(data);
                }
            }
        }
    }

    // 拦截 XHR 分析内容
    const _xhrOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method) {
        method = method.toUpperCase();
        CATCH_SEARCH_DEBUG && _log(this);
        this.addEventListener("readystatechange", function (event) {
            CATCH_SEARCH_DEBUG && _log(this);
            if (this.status != 200) { return; }
            // 查找疑似key
            if (this.responseType == "arraybuffer" && this.response?.byteLength && this.response.byteLength == 16) {
                postData({ action: "catCatchAddKey", key: this.response, href: location.href, ext: "key" });
            }
            if (this.response == "" || typeof this.response != "string") { return; }
            if (this.response.substring(0, 17).toLowerCase() == "data:application/") {
                const text = getDataM3U8(this.response.substring(17));
                text && toUrl(text);
                return;
            }
            if (this.responseURL.substring(0, 17).toLowerCase() == "data:application/") {
                const text = getDataM3U8(this.responseURL.substring(17));
                text && toUrl(text);
                return;
            }
            if (isUrl(this.response)) {
                const ext = getExtension(this.response);
                ext && postData({ action: "catCatchAddMedia", url: this.response, href: location.href, ext: ext });
                return;
            }
            if (this.response.toUpperCase().includes("#EXTM3U")) {
                if (this.response.substring(0, 7) == "#EXTM3U") {
                    if (method == "GET") {
                        let BashUrl = this.responseURL.split("/");
                        BashUrl.pop();
                        BashUrl = BashUrl.join("/") + "/";
                        toUrl(addBashUrl(BashUrl, this.response));
                        postData({ action: "catCatchAddMedia", url: this.responseURL, href: location.href, ext: "m3u8" });
                        return;
                    }
                    isFullM3u8(this.response) && toUrl(this.response);
                    return;
                }
                if (isJSON(this.response)) {
                    if (method == "GET") {
                        postData({ action: "catCatchAddMedia", url: this.responseURL, href: location.href, ext: "json" });
                        return;
                    }
                    toUrl(this.response, "json");
                    return;
                }
            }
            const isJson = isJSON(this.response);
            if (isJson) {
                findMedia(isJson);
                return;
            }
        });
        _xhrOpen.apply(this, arguments);
    }
    XMLHttpRequest.prototype.open.toString = function () {
        return _xhrOpen.toString();
    }

    // 拦截 fetch 分析内容
    const _fetch = window.fetch;
    window.fetch = async function (input, init) {
        const response = await _fetch.apply(this, arguments);
        const clone = response.clone();
        CATCH_SEARCH_DEBUG && _log(response);
        response.arrayBuffer()
            .then(arrayBuffer => {
                CATCH_SEARCH_DEBUG && _log({ arrayBuffer, input });
                if (arrayBuffer.byteLength == 16) {
                    postData({ action: "catCatchAddKey", key: arrayBuffer, href: location.href, ext: "key" });
                    return;
                }
                let text = new TextDecoder().decode(arrayBuffer);
                if (text == "") { return; }
                if (typeof input == "object") { input = input.url; }
                let isJson = isJSON(text);
                if (isJson) {
                    findMedia(isJson);
                    return;
                }
                if (text.substring(0, 7).toUpperCase() == "#EXTM3U") {
                    if (init?.method == undefined || (init.method && init.method.toUpperCase() == "GET")) {
                        postData({ action: "catCatchAddMedia", url: input, href: location.href, ext: "m3u8" });
                        return;
                    }
                    isFullM3u8(text) && toUrl(text);
                    return;
                }
                if (text.substring(0, 17).toLowerCase() == "data:application/") {
                    const text = getDataM3U8(text.substring(0, 17));
                    text && toUrl(text);
                    return;
                }
            });
        return clone;
    }
    window.fetch.toString = function () {
        return _fetch.toString();
    }

    // 拦截 Array.prototype.slice
    const _slice = Array.prototype.slice;
    Array.prototype.slice = function (start, end) {
        let data = _slice.apply(this, arguments);
        if (end == 16 && this.length == 32) {
            for (let item of data) {
                if (typeof item != "number" || item > 255) { return data; }
            }
            postData({ action: "catCatchAddKey", key: data, href: location.href, ext: "key" });
        }
        return data;
    }
    Array.prototype.slice.toString = function () {
        return _slice.toString();
    }

    // 拦截 window.btoa / window.atob
    const _btoa = window.btoa;
    window.btoa = function (data) {
        const base64 = _btoa.apply(this, arguments);
        CATCH_SEARCH_DEBUG && _log(base64, data, base64.length);
        if (base64.length == 24 && base64.substring(22, 24) == "==") {
            postData({ action: "catCatchAddKey", key: base64, href: location.href, ext: "base64Key" });
        }
        if (data.substring(0, 7).toUpperCase() == "#EXTM3U" && isFullM3u8(data)) {
            toUrl(data);
        }
        return base64;
    }
    window.btoa.toString = function () {
        return _btoa.toString();
    }
    const _atob = window.atob;
    window.atob = function (base64) {
        const data = _atob.apply(this, arguments);
        CATCH_SEARCH_DEBUG && _log(base64, data, base64.length);
        if (base64.length == 24 && base64.substring(22, 24) == "==") {
            postData({ action: "catCatchAddKey", key: base64, href: location.href, ext: "base64Key" });
        }
        if (data.substring(0, 7).toUpperCase() == "#EXTM3U" && isFullM3u8(data)) {
            toUrl(data);
        }
        return data;
    }
    window.atob.toString = function () {
        return _atob.toString();
    }

    // 拦截fromCharCode
    const _fromCharCode = String.fromCharCode;
    let m3u8Text = '';
    String.fromCharCode = function () {
        const data = _fromCharCode.apply(this, arguments);
        if (data.length < 7) { return data; }
        if (data.substring(0, 7) == "#EXTM3U" || data.includes("#EXTINF:")) {
            m3u8Text += data;
            if (m3u8Text.includes("#EXT-X-ENDLIST")) {
                toUrl(m3u8Text.split("#EXT-X-ENDLIST")[0] + "#EXT-X-ENDLIST");
                m3u8Text = '';
            }
            return data;
        }
        const key = data.replaceAll("\u0010", "");
        if (key.length == 32) {
            postData({ action: "catCatchAddKey", key: key, href: location.href, ext: "key" });
        }
        return data;
    }
    String.fromCharCode.toString = function () {
        return _fromCharCode.toString();
    }

    // 正则预编译
    const reKeyURL = /URI="(.*)"/;
    const reIsUrl = /^http[s]*:\/\/.+/i;

    function isUrl(str) {
        return reIsUrl.test(str);
    }
    function isFullM3u8(text) {
        let tsLists = text.split("\n");
        for (let ts of tsLists) {
            if (ts[0] == "#") { continue; }
            if (isUrl(ts)) { return true; }
            return false;
        }
        return false;
    }
    function addBashUrl(baseUrl, m3u8Text) {
        let m3u8_split = m3u8Text.split("\n");
        m3u8Text = "";
        for (let key in m3u8_split) {
            if (isEmpty(m3u8_split[key])) { continue; }
            if (m3u8_split[key].includes("URI=")) {
                let KeyURL = reKeyURL.exec(m3u8_split[key]);
                if (KeyURL && KeyURL[1] && !isUrl(KeyURL[1])) {
                    m3u8_split[key] = m3u8_split[key].replace(reKeyURL, 'URI="' + baseUrl + KeyURL[1] + '"');
                }
            }
            if (!m3u8_split[key].includes("#") && !isUrl(m3u8_split[key])) {
                m3u8_split[key] = baseUrl + m3u8_split[key];
            }
            m3u8Text += m3u8_split[key] + "\n";
        }
        return m3u8Text;
    }
    function isJSON(str) {
        if (typeof str == "object") {
            return str;
        }
        if (typeof str == "string") {
            try {
                return _JSONparse(str);
            } catch (e) { return false; }
        }
        return false;
    }
    function getExtension(str) {
        let ext;
        try { ext = new URL(str); } catch (e) { return undefined; }
        ext = ext.pathname.split(".");
        if (ext.length == 1) { return undefined; }
        ext = ext[ext.length - 1].toLowerCase();
        if (ext == "m3u8" ||
            ext == "m3u" ||
            ext == "mpd" ||
            ext == "mp4" ||
            ext == "mp3" ||
            ext == "key"
        ) { return ext; }
        return false;
    }
    function toUrl(text, ext = "m3u8") {
        let url = URL.createObjectURL(new Blob([new TextEncoder("utf-8").encode(text)]));
        postData({ action: "catCatchAddMedia", url: url, href: location.href, ext: ext });
    }
    function getDataM3U8(text) {
        const type = ["vnd.apple.mpegurl", "x-mpegurl", "mpegurl"];
        let isM3U8 = false;
        for (let item of type) {
            if (text.substring(0, item.length).toLowerCase() == item) {
                text = text.substring(item.length + 1);
                isM3U8 = true;
                break;
            }
        }
        if (!isM3U8) { return false; }
        if (text.substring(0, 7).toLowerCase() == "base64,") {
            return window.atob(text.substring(7));
        }
        return text;
    }
    function postData(data) {
        const key = data.url ? data.url : data.key;
        if (filter.has(key)) { return false; }
        filter.add(key);
        data.requestId = Date.now().toString() + filter.size;
        window.postMessage(data);
    }
    function isEmpty(obj) {
        return (typeof obj == "undefined" || obj == null || obj == "" || obj == " ");
    }
})();