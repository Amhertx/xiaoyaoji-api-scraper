// ==UserScript==
// @name         小幺鸡接口自动抓取
// @namespace    http://tampermonkey.net/
// @version      2.30
// @description  自动抓取小幺鸡项目所有接口数据
// @match        https://www.xiaoyaoji.cn/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    const CLICK_BATCH_SIZE = 5;
    const BATCH_INTERVAL = 30;
    const MAX_WAIT = 10000;
    let isRunning = false;

    function downloadFile(content, filename) {
        const blob = new Blob([content], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    function cleanText(text, keepBr = false) {
        if (!text) return '';
        if (keepBr) {
            text = text.replace(/<br\s*\/?>/gi, '<br>').replace(/<\/(p|div|li)>/gi, '<br>');
            text = text.replace(/<(?!br\s*\/?>)[^>]+>/g, '');
            text = text.replace(/\n/g, '<br>').replace(/\|/g, '\\|').replace(/(<br>\s*){2,}/g, '<br>');
            return text.replace(/^<br>/, '').replace(/<br>$/, '').trim();
        }
        return text.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    }

    async function fetchInterfaceNames(folderIds) {
        const docIdToNameMap = new Map();
        const ids = [...(folderIds || [])];

        // 如果没有传入folderIds，尝试从URL中提取
        if (ids.length === 0) {
            const urlMatch = window.location.href.match(/xiaoyaoji\.cn\/project\/[^\/]+\/([^\/]+)/);
            if (urlMatch) ids.push(urlMatch[1]);
        }

        if (ids.length === 0) {
            console.log('[接口名称] 没有文件夹ID，跳过');
            return docIdToNameMap;
        }

        console.log('[接口名称] 获取接口名称，文件夹IDs:', ids);

        await Promise.all(ids.map(async (folderId) => {
            try {
                const resp = await fetch(`https://api.xiaoyaoji.cn/project/document/children/${folderId}`, {
                    method: 'GET', headers: { 'Accept': 'application/json' }
                });
                if (!resp.ok) return;
                const data = await resp.json();
                if (data.code === 0 && data.data) {
                    data.data.forEach(doc => {
                        if (doc.docId && doc.name) docIdToNameMap.set(doc.docId, doc.name);
                    });
                }
            } catch (e) {
                console.error(`[接口名称] 文件夹 ${folderId} 获取失败:`, e);
            }
        }));

        console.log(`[接口名称] 共获取 ${docIdToNameMap.size} 个映射`);
        return docIdToNameMap;
    }

    function showNotification(title, message, type = 'success') {
        if (!document.getElementById('notification-styles')) {
            const style = document.createElement('style');
            style.id = 'notification-styles';
            style.textContent = `
                @keyframes xnSlideIn{from{transform:translateX(100%);opacity:0}to{transform:translateX(0);opacity:1}}
                @keyframes xnSlideOut{from{transform:translateX(0);opacity:1}to{transform:translateX(100%);opacity:0}}
                #notification-container{position:fixed;top:20px;right:20px;z-index:99999;display:flex;flex-direction:column;gap:10px;max-width:400px}
                .xn-notify{padding:16px 20px;border-radius:8px;background:#fff;color:#333;box-shadow:0 4px 12px rgba(0,0,0,.15);position:relative;animation:xnSlideIn .3s ease;font-family:"Noto Sans SC","Source Han Sans SC","思源黑体",sans-serif}
                .xn-notify-success{border-left:4px solid #52c41a}.xn-notify-error{border-left:4px solid #ff4d4f}.xn-notify-info{border-left:4px solid #1890ff}
                .xn-notify button{position:absolute;top:8px;right:8px;background:none;border:none;font-size:20px;cursor:pointer;color:#999;padding:0;width:24px;height:24px;display:flex;align-items:center;justify-content:center}
                .xn-notify button:hover{color:#333}
                .xn-notify-title{font-weight:600;font-size:16px;margin-bottom:8px;color:#101010;padding-right:24px}
                .xn-notify-msg{font-size:14px;line-height:1.5;color:#666;white-space:pre-line;max-height:200px;overflow-y:auto}
            `;
            document.head.appendChild(style);
        }

        let container = document.getElementById('notification-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'notification-container';
            document.body.appendChild(container);
        }

        const notification = document.createElement('div');
        notification.className = `xn-notify xn-notify-${type}`;
        notification.innerHTML = `<button>&times;</button><div class="xn-notify-title"></div><div class="xn-notify-msg"></div>`;
        notification.querySelector('.xn-notify-title').textContent = title;
        notification.querySelector('.xn-notify-msg').textContent = message;

        notification.querySelector('button').onclick = () => {
            notification.style.animation = 'xnSlideOut 0.3s ease';
            setTimeout(() => {
                notification.remove();
                if (!container.children.length) container.remove();
            }, 300);
        };

        container.appendChild(notification);
        setTimeout(notification.querySelector('button').onclick, 10000);
    }

    function getExcludeNames() {
        // 方式1: 从 Vuex store 动态获取文件夹名
        const vuex = window.$nuxt?.$store?.state;
        const docs = vuex?.doc?.docs;
        if (docs) {
            const names = new Set();
            Object.values(docs).forEach(doc => {
                if (doc.type === 'folder' && doc.name) {
                    names.add(doc.name.trim());
                }
            });
            if (names.size > 0) return names;
        }

        // 方式2: DOM 启发式 —— 找文件夹容器，提取其内部链接文本
        const folderSelectors = [
            '.doc-folder', '.folder-item', '.tree-node.folder',
            '.menu-folder', '[data-type="folder"]', '.nav-folder'
        ];
        for (const sel of folderSelectors) {
            const folders = document.querySelectorAll(sel);
            if (folders.length > 0) {
                const names = new Set();
                folders.forEach(f => {
                    f.querySelectorAll('a.link').forEach(a => {
                        const t = a.textContent.trim();
                        if (t) names.add(t);
                    });
                });
                if (names.size > 0) return names;
            }
        }

        return new Set();
    }

    function findAllInterfaces() {
        const links = document.querySelectorAll('a.link.viewMode');
        const interfaces = [];
        const seen = new Set();
        const excludeNames = getExcludeNames();

        links.forEach(link => {
            const text = link.textContent.trim();
            const href = link.getAttribute('href') || '';
            const dataId = link.getAttribute('data-id') || link.id || '';
            
            // 尝试从href中提取docId
            let docId = '';
            const hrefMatch = href.match(/\/project\/[^\/]+\/([^\/\?#]+)/);
            if (hrefMatch) {
                docId = hrefMatch[1];
            }
            
            // 如果href为空，尝试从元素属性中获取
            if (!docId) {
                // 尝试获取data-doc-id属性
                const dataDocId = link.getAttribute('data-doc-id') || link.getAttribute('docid');
                if (dataDocId) {
                    docId = dataDocId;
                }
                
                // 尝试从父元素获取
                if (!docId && link.parentElement) {
                    const parentDocId = link.parentElement.getAttribute('data-doc-id') || link.parentElement.getAttribute('docid');
                    if (parentDocId) {
                        docId = parentDocId;
                    }
                }
                
                // 尝试从元素内部的其他属性获取
                if (!docId) {
                    const allAttrs = link.attributes;
                    for (let i = 0; i < allAttrs.length; i++) {
                        const attrName = allAttrs[i].name;
                        const attrValue = allAttrs[i].value;
                        // 如果属性值看起来像ID（通常是字母数字组合，长度在10-20之间）
                        if (attrValue && attrValue.length >= 10 && attrValue.length <= 20 && /^[a-zA-Z0-9]+$/.test(attrValue)) {
                            docId = attrValue;
                            console.log(`[接口发现] 从属性 ${attrName} 提取docId: ${docId}`);
                            break;
                        }
                    }
                }
            }
            
            if (text && text.length >= 2 && text.length <= 50 && !excludeNames.has(text)) {
                if (!seen.has(text)) {
                    seen.add(text);
                    interfaces.push({ 
                        name: text, 
                        element: link,
                        href: href,
                        dataId: dataId,
                        docId: docId
                    });
                    
                    // 调试日志
                    console.log(`[接口发现] 名称: ${text}, docId: ${docId}`);
                }
            }
        });

        console.log(`[接口发现] 共找到 ${interfaces.length} 个接口`);
        return interfaces;
    }

    async function clickElement(el) {
        try {
            el.scrollIntoView({ behavior: 'instant', block: 'center' });
            el.click();
            return true;
        } catch(e) {
            return false;
        }
    }

    function parseFields(fields, depth = 0) {
        const result = {};
        if (!fields || !Array.isArray(fields)) return result;

        fields.forEach(field => {
            if (!field.name) return;

            const prop = {
                type: field.type || 'string',
                description: field.description || ''
            };

            // 提取必填字段
            if (field.required !== undefined) {
                prop.required = field.required;
            }

            // 提取默认值（优先使用default，其次value）
            if (field.default !== undefined && field.default !== '') {
                prop.default = field.default;
            } else if (field.value !== undefined && field.value !== '') {
                prop.default = field.value;
                prop.example = field.type === 'number' ? Number(field.value) : field.value;
            }

            if (field.children && field.children.length > 0) {
                const childFields = parseFields(field.children, depth + 1);
                if (Object.keys(childFields).length > 0) {
                    prop.properties = childFields;
                }
            }

            result[field.name] = prop;
        });

        return result;
    }

    function parseResponseBody(respBody) {
        if (!respBody || !Array.isArray(respBody)) return {};
        const bodyFields = respBody[0]?.body;
        if (!bodyFields) return {};
        return parseFields(bodyFields);
    }

    function generateExample(schema) {
        const example = {};
        if (!schema || typeof schema !== 'object') return null;

        for (const [key, value] of Object.entries(schema)) {
            if (typeof value === 'object' && value !== null) {
                if (value.example !== undefined) {
                    example[key] = value.example;
                } else if (value.properties) {
                    example[key] = generateExample(value.properties);
                } else if (value.type === 'array') {
                    example[key] = [generateExample(value.properties || {}) || {}];
                } else if (value.type === 'object') {
                    example[key] = generateExample(value.properties || {});
                } else {
                    example[key] = value.type === 'number' ? 1 : (value.description ? `示例${key}` : null);
                }
            } else {
                example[key] = null;
            }
        }
        return example;
    }

    function setupXHRInterception() {
        const OriginalXHR = window.XMLHttpRequest;
        const state = { rawResponses: [], interfaceNameMap: new Map(), requestCount: 0, responseCount: 0, currentName: '' };

        window.XMLHttpRequest = function() {
            const xhr = new OriginalXHR();
            const origOpen = xhr.open;
            const origSend = xhr.send;

            xhr.open = function(...args) { this._url = args[1]; return origOpen.apply(this, args); };
            xhr.send = function(...args) {
                if (this._url && this._url.includes('/project/document/') && !this._url.includes('mock-config')) {
                    state.requestCount++;
                    const url = this._url, name = state.currentName;
                    this.addEventListener('load', () => {
                        state.responseCount++;
                        try {
                            const data = JSON.parse(this.responseText);
                            if (data?.data?.docId) {
                                if (name) state.interfaceNameMap.set(data.data.docId, name);
                                state.rawResponses.push({ docId: data.data.docId, data: data.data, url, interfaceName: name });
                            }
                        } catch(e) {}
                    });
                }
                return origSend.apply(this, args);
            };
            return xhr;
        };

        state.restore = () => { window.XMLHttpRequest = OriginalXHR; };
        return state;
    }

    async function clickAndWait(apiItems, xhrState) {
        for (let i = 0; i < apiItems.length; i++) {
            updateButton(`点击 ${i + 1}/${apiItems.length}`);
            xhrState.currentName = apiItems[i].name;
            await clickElement(apiItems[i].element);
            if ((i + 1) % CLICK_BATCH_SIZE === 0) {
                await new Promise(r => setTimeout(r, BATCH_INTERVAL));
            }
        }

        console.log(`点击完成, 等待响应...`);
        const start = Date.now();
        await new Promise(resolve => {
            const timer = setInterval(() => {
                const elapsed = Math.floor((Date.now() - start) / 1000);
                updateButton(`等待响应 (${xhrState.responseCount}/${xhrState.requestCount}) ${elapsed}s`);
                if (xhrState.responseCount >= xhrState.requestCount || (Date.now() - start) >= MAX_WAIT) {
                    clearInterval(timer);
                    resolve();
                }
            }, 200);
        });
    }

    async function collectInterfaceNames() {
        const map = new Map();
        const vuex = window.$nuxt?.$store?.state;
        const docs = vuex?.doc?.docs;

        // 来源1: Vuex store
        if (docs) {
            Object.values(docs).forEach(d => { if (d.docId && d.name) map.set(d.docId, d.name); });
            console.log(`[来源1] Vuex: ${map.size} 个`);
        }

        // 来源2: window.__NUXT__ 递归提取
        if (window.__NUXT__) {
            (function extract(obj) {
                if (!obj || typeof obj !== 'object') return;
                if (obj.docId && obj.name && obj.type === 'doc') map.set(obj.docId, obj.name);
                for (const key in obj) { if (obj.hasOwnProperty(key)) extract(obj[key]); }
            })(window.__NUXT__);
            console.log(`[来源2] __NUXT__: ${map.size} 个`);
        }

        // 来源3: API调用（fetchInterfaceNames自动处理URL提取）
        const apiMap = await fetchInterfaceNames();
        apiMap.forEach((name, id) => map.set(id, name));
        console.log(`[来源3] API: 共 ${map.size} 个`);

        return map;
    }

    function buildOpenAPISpec(rawResponses, docIdToNameMap, interfaceNameMap, folderMap) {
        const projectName = document.querySelector('.pro-name')?.textContent?.trim() || 'API文档';
        const openapi = {
            openapi: '3.0.0',
            info: { title: `${projectName} API`, version: '1.0.0', description: '从小幺鸡自动抓取' },
            servers: [], tags: [], paths: {}, components: { schemas: {} }
        };

        rawResponses.forEach(({ docId, data }) => {
            try {
                const httpApi = data.content?.data?.content?.[0]?.attrs?.doc;
                if (!httpApi) return;

                const method = (httpApi.requestMethod || 'GET').toLowerCase();
                const path = httpApi.url || '';
                const parentId = data.parentId;
                if (!path || !path.startsWith('/')) return;

                // 解析接口名称
                let interfaceName = docIdToNameMap.get(docId) || interfaceNameMap.get(docId) || '';
                let displayName = '';
                if (interfaceName && interfaceName.length >= 2) {
                    displayName = cleanText(interfaceName);
                }
                if (!displayName) {
                    for (const [field, val] of [['name', httpApi.name], ['title', httpApi.title], ['summary', httpApi.summary], ['simpleDesc', httpApi.simpleDesc]]) {
                        if (val) { const c = cleanText(val); if (c && c.length >= 2) { displayName = c; break; } }
                    }
                }
                if (!displayName) displayName = path;

                // 解析参数
                const req = httpApi.req || {};
                const parameters = [];
                for (const [items, loc] of [[req.headers || [], 'header'], [req.query || [], 'query']]) {
                    items.forEach(p => {
                        if (p.name) parameters.push({ name: p.name, in: loc, required: p.required, schema: { type: p.type || 'string' }, description: p.description || '', example: p.value, default: p.default });
                    });
                }

                // 解析请求体
                let requestBodyObj = null;
                const reqBody = req.body || [];
                if (reqBody.length > 0 && req.bodyType === 'X-WWW-FORM-URLENCODED') {
                    const properties = {}, example = {}, requiredFields = [];
                    reqBody.forEach(p => {
                        if (!p.name) return;
                        const prop = { type: p.type || 'string', description: p.description || '' };
                        if (p.required !== undefined) { prop.required = p.required; if (p.required) requiredFields.push(p.name); }
                        const def = p.default !== undefined ? p.default : p.value;
                        if (def !== undefined && def !== '') { prop.default = def; example[p.name] = p.type === 'number' ? Number(def) : def; }
                        properties[p.name] = prop;
                    });
                    if (Object.keys(properties).length > 0) {
                        requestBodyObj = { content: { 'application/x-www-form-urlencoded': { schema: { type: 'object', properties, required: requiredFields.length > 0 ? requiredFields : undefined }, example } } };
                    }
                }

                // 解析响应
                const responseSchema = parseResponseBody(httpApi.resp?.body);
                const category = path.split('/')[1] || 'default';
                const cnCategory = folderMap[parentId] || category;

                if (!openapi.paths[path]) openapi.paths[path] = {};
                const operation = {
                    summary: displayName, description: httpApi.simpleDesc ? httpApi.simpleDesc.replace(/<[^>]+>/g, '') : '',
                    tags: [cnCategory], parameters: parameters.length > 0 ? parameters : undefined,
                    responses: { '200': { description: httpApi.resp?.desc || '成功', content: { 'application/json': { schema: { type: 'object', properties: responseSchema }, example: generateExample(responseSchema) } } } }
                };
                if (requestBodyObj) operation.requestBody = requestBodyObj;
                openapi.paths[path][method] = operation;
            } catch (e) { console.log(`处理接口 ${docId} 出错:`, e.message); }
        });

        // 生成 tags
        const usedTags = new Set();
        Object.values(openapi.paths).forEach(methods => {
            Object.values(methods).forEach(api => {
                if (api.tags?.[0] && !usedTags.has(api.tags[0])) {
                    usedTags.add(api.tags[0]);
                    openapi.tags.push({ name: api.tags[0], description: `${api.tags[0]}相关接口` });
                }
            });
        });

        return { openapi, projectName };
    }

    function generateMarkdownDoc(openapi, projectName) {
        let doc = `# ${projectName} API 接口文档\n> 生成时间: ${new Date().toLocaleString()}\n> 接口总数: ${Object.keys(openapi.paths).length}\n\n`;

        const paramTable = (title, params) => {
            if (!params.length) return '';
            let s = `\n**${title}:**\n\n| 参数名 | 类型 | 必填 | 默认值 | 描述 |\n|--------|------|------|--------|------|\n`;
            params.forEach(p => {
                s += `| ${p.name} | ${p.schema?.type || 'string'} | ${p.required ? '是' : '否'} | ${p.example || p.default || '-'} | ${cleanText(p.description, true) || '-'} |\n`;
            });
            return s;
        };

        openapi.tags.forEach(tag => {
            doc += `## ${tag.name}\n\n`;
            Object.entries(openapi.paths).forEach(([path, methods]) => {
                Object.entries(methods).forEach(([method, api]) => {
                    if (api.tags?.[0] !== tag.name) return;
                    doc += `### ${api.summary}\n- **请求方式**: \`${method.toUpperCase()}\`\n- **请求路径**: \`${path}\`\n`;
                    if (api.description) doc += `- **接口描述**: ${api.description}\n`;

                    const params = api.parameters || [];
                    doc += paramTable('请求头参数', params.filter(p => p.in === 'header'));
                    doc += paramTable('Query参数', params.filter(p => p.in === 'query'));

                    // Body参数
                    const bodyContent = api.requestBody?.content?.['application/x-www-form-urlencoded'];
                    if (bodyContent?.schema?.properties) {
                        const props = bodyContent.schema.properties, ex = bodyContent.example, reqFields = bodyContent.schema.required || [];
                        doc += `\n**Body参数:**\n\n| 参数名 | 类型 | 必填 | 默认值 | 描述 |\n|--------|------|------|--------|------|\n`;
                        Object.entries(props).forEach(([name, prop]) => {
                            doc += `| ${name} | ${prop.type || 'string'} | ${reqFields.includes(name) ? '是' : '否'} | ${prop.default !== undefined ? prop.default : (ex?.[name] || '-')} | ${cleanText(prop.description, true) || '-'} |\n`;
                        });
                    }

                    // 响应参数
                    const respSchema = api.responses?.['200']?.content?.['application/json']?.schema;
                    if (respSchema?.properties) {
                        const respEx = api.responses['200'].content['application/json'].example;
                        doc += `\n**响应参数:**\n\n| 参数名 | 类型 | 描述 | 示例值 |\n|--------|------|------|--------|\n`;
                        Object.entries(respSchema.properties).forEach(([name, prop]) => {
                            doc += `| ${name} | ${prop.type || 'string'} | ${cleanText(prop.description, true) || '-'} | ${respEx?.[name] !== undefined ? JSON.stringify(respEx[name]) : '-'} |\n`;
                        });
                    }
                    doc += '\n---\n\n';
                });
            });
        });
        return doc;
    }

    async function main() {
        if (isRunning) return;
        isRunning = true;
        updateButton('采集中...');

        const apiItems = findAllInterfaces();
        if (apiItems.length === 0) { isRunning = false; updateButton('开始采集'); return; }
        updateButton(`准备点击 ${apiItems.length} 个...`);

        // 拦截XHR并点击
        const xhrState = setupXHRInterception();
        try { await clickAndWait(apiItems, xhrState); }
        finally { xhrState.restore(); }

        if (xhrState.rawResponses.length === 0) {
            showNotification('错误', '未捕获到数据！请刷新页面后重试。', 'error');
            isRunning = false; updateButton('开始采集'); return;
        }

        updateButton('处理中...');

        // 收集文件夹映射和接口名称
        const docs = window.$nuxt?.$store?.state?.doc?.docs;
        const folderMap = {};
        Object.values(docs || {}).forEach(d => { if (d.type === 'folder') folderMap[d.docId] = d.name; });

        const docIdToNameMap = await collectInterfaceNames();

        // 生成 OpenAPI 和 Markdown
        const { openapi, projectName } = buildOpenAPISpec(xhrState.rawResponses, docIdToNameMap, xhrState.interfaceNameMap, folderMap);
        const apifoxFilename = `apifox_import_${Date.now()}.json`;
        const projectFilename = `api_doc_${Date.now()}.md`;

        downloadFile(JSON.stringify(openapi, null, 2), apifoxFilename);
        downloadFile(generateMarkdownDoc(openapi, projectName), projectFilename);

        const count = Object.keys(openapi.paths).length;
        showNotification('抓取完成', `接口总数: ${count}\n已下载:\n- ${apifoxFilename} (Apifox导入)\n- ${projectFilename} (项目文档)`, 'success');
        isRunning = false;
        updateButton('开始采集');
    }

    let btn = null;

    function createButton() {
        if (!window.location.href.includes('/project/')) return;
        if (document.getElementById('xiaoyaoji-fetch-btn')) return;

        btn = document.createElement('div');
        btn.id = 'xiaoyaoji-fetch-btn';
        btn.textContent = '开始采集';
        btn.style.cssText = `
            position: relative; display: inline-block; vertical-align: middle;
            background: linear-gradient(135deg, #FF5B00, #FF8C00); color: white;
            padding: 6px 16px; border-radius: 20px; cursor: pointer;
            font-size: 13px; font-weight: bold;
            box-shadow: 0 2px 8px rgba(255, 91, 0, 0.3);
            transition: all 0.3s ease; user-select: none; white-space: nowrap;
            margin-left: 10px;
        `;
        btn.onmouseover = () => { btn.style.transform = 'scale(1.05)'; btn.style.boxShadow = '0 4px 12px rgba(255, 91, 0, 0.5)'; };
        btn.onmouseout = () => { btn.style.transform = 'scale(1)'; btn.style.boxShadow = '0 2px 8px rgba(255, 91, 0, 0.3)'; };
        btn.onclick = () => { if (!isRunning) main(); };

        tryCreateButton();
    }

    function tryCreateButton() {
        const docTopEl = document.querySelector('.doc-top');
        if (!docTopEl) { setTimeout(tryCreateButton, 500); return; }

        const containerEl = docTopEl.querySelector('.doc-container.doc-top-sec');
        if (!containerEl) { docTopEl.appendChild(btn); return; }

        // 优先级1: 历史记录按钮（直接子元素时在其前插入）
        const historyBtn = containerEl.querySelector('[class*="history"], [title*="历史"], [aria-label*="历史"]');
        if (historyBtn && historyBtn.parentElement === containerEl) {
            containerEl.insertBefore(btn, historyBtn);
            return;
        }
        // 历史记录按钮在嵌套容器中时，插入到其父容器
        if (historyBtn && historyBtn.parentElement) {
            historyBtn.parentElement.insertBefore(btn, historyBtn);
            return;
        }

        // 优先级2-4: 按顺序查找 right / toolbar / 第一个子元素
        const fallbacks = [':scope > .right', '.toolbar, .tools, [class*="tool"], [class*="action"]'];
        for (const sel of fallbacks) {
            const el = containerEl.querySelector(sel);
            if (el) { containerEl.insertBefore(btn, el); return; }
        }
        if (containerEl.firstElementChild) {
            containerEl.insertBefore(btn, containerEl.firstElementChild);
            return;
        }

        // 兜底: 查找包含"历史"文本的元素
        for (const el of containerEl.querySelectorAll('*')) {
            const text = el.textContent || '';
            const title = el.getAttribute('title') || '';
            const ariaLabel = el.getAttribute('aria-label') || '';
            const className = el.className || '';
            if (text.includes('历史') || title.includes('历史') || ariaLabel.includes('历史') || className.includes('history')) {
                containerEl.insertBefore(btn, el);
                return;
            }
        }

        containerEl.appendChild(btn);
    }

    function updateButton(text) {
        if (btn) btn.textContent = text;
    }

    // 监听URL变化（用于单页应用路由跳转）
    let lastUrl = window.location.href;
    const urlChangeObserver = new MutationObserver(() => {
        if (window.location.href !== lastUrl) {
            lastUrl = window.location.href;
            setTimeout(() => {
                if (!document.getElementById('xiaoyaoji-fetch-btn') && lastUrl.includes('/project/')) {
                    createButton();
                }
            }, 1000);
        }
    });
    
    // 开始监听
    urlChangeObserver.observe(document, { subtree: true, childList: true });
    
    // 初始创建按钮
    if (document.readyState === 'complete') setTimeout(createButton, 1000);
    else window.addEventListener('load', () => setTimeout(createButton, 1000));
})();
