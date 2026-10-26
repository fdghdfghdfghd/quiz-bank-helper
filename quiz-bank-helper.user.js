// ==UserScript==
// @name         练习题库助手-最高匹配答案
// @namespace    practice-question-helper
// @version      5.0.0
// @description  读取网页文字，匹配DOCX题库，始终显示最高匹配题目、答案和原题
// @match        *://*/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    if (document.getElementById('qbh-panel')) return;

    const MAX_CANDIDATES = 700;
    const MAX_PAGE_CHARS = 50000;

    let questionBank = [];
    let featureCache = new Map();
    let busy = false;
    let mammothPromise = null;

    // ==================== 基础工具 ====================

    function normalize(text) {
        return String(text || '')
            .normalize('NFKC')
            .toLowerCase()
            .replace(/\s+/g, '')
            .replace(/[“”"'‘’`]/g, '')
            .replace(/[【】[\]（）(){}<>《》]/g, '')
            .replace(/[：:，,。.!！?？；;、]/g, '');
    }

    function unique(arr) {
        return [...new Set(arr)];
    }

    function setStatus(text) {
        document.getElementById('qbh-status').textContent = text;
    }

    // ==================== 解析答案 ====================

    function parseAnswerLine(line) {
        const match = String(line || '').match(
            /^\s*(?:(?:参考|正确|标准)?答案|答)\s*[:：、]?\s*(.*?)\s*$/
        );

        if (!match || !match[1].trim()) return null;

        const raw = match[1].trim();
        const normalized = raw.normalize('NFKC').toUpperCase().trim();

        // 单选、多选：A / B / ACD / A,C,D / A、C、D
        if (/^[A-D](?:[\s、，,；;．.·/／|＋+和及&]*[A-D])*$/.test(normalized)) {
            const letters = unique(normalized.match(/[A-D]/g) || []);

            return {
                answer: letters.join(''),
                answerType: letters.length > 1 ? '多选题' : '单选题'
            };
        }

        // 填空题、判断题、简答题：保留完整答案
        return {
            answer: raw,
            answerType: '文字答案'
        };
    }

    // ==================== 解析 Word 题库 ====================

    function isQuestionStart(line) {
        return /^(?:(?:第\s*)?\d{1,4}\s*[.．、)）:：]\s*\S|第\s*\d+\s*题\s*[:：]?\s*\S|[（(]\s*\d+\s*[）)]\s*\S)/.test(
            String(line || '').trim()
        );
    }

    function removeQuestionNumber(line) {
        return String(line || '')
            .trim()
            .replace(/^(?:第\s*)?\d{1,4}\s*[.．、)）:：]\s*/, '')
            .replace(/^第\s*\d+\s*题\s*[:：]?\s*/, '')
            .replace(/^[（(]\s*\d+\s*[）)]\s*/, '')
            .trim();
    }

    function isOptionLine(line) {
        return /^\s*[A-DＡ-Ｄ]\s*[.．、:：)）]\s*\S/i.test(line);
    }

    function parseBank(rawText) {
        const lines = String(rawText || '')
            .replace(/\r\n?/g, '\n')
            .split('\n')
            .map(line => line.trim())
            .filter(Boolean);

        const bank = [];
        let current = null;

        function finish() {
            if (!current) return;

            const question = current.parts.join(' ')
                .replace(/\s+/g, ' ')
                .trim();

            if (question) {
                const options = current.options.slice();

                bank.push({
                    id: bank.length + 1,
                    question,
                    options,
                    answer: current.answer || '',
                    answerType: current.answerType || '未识别',
                    normalized: normalize(question),
                    fullNormalized: normalize(
                        question + ' ' + options.join(' ')
                    )
                });
            }

            current = null;
        }

        for (const line of lines) {
            const answerInfo = parseAnswerLine(line);

            if (answerInfo && current) {
                current.answer = answerInfo.answer;
                current.answerType = answerInfo.answerType;
                continue;
            }

            if (isQuestionStart(line)) {
                finish();

                current = {
                    parts: [removeQuestionNumber(line)],
                    options: [],
                    answer: '',
                    answerType: '未识别'
                };

                continue;
            }

            if (!current) {
                const title = line.match(
                    /^(?:题目|试题|问题)\s*[:：]\s*(.+)$/
                );

                if (title) {
                    current = {
                        parts: [title[1].trim()],
                        options: [],
                        answer: '',
                        answerType: '未识别'
                    };
                }

                continue;
            }

            if (isOptionLine(line)) {
                current.options.push(line);
            } else {
                current.parts.push(line);
            }
        }

        finish();

        // 兜底：处理没有编号、但使用“题目：”格式的文件
        if (!bank.length) {
            let fallback = null;

            for (const line of lines) {
                const answerInfo = parseAnswerLine(line);

                if (answerInfo && fallback) {
                    fallback.answer = answerInfo.answer;
                    fallback.answerType = answerInfo.answerType;
                    continue;
                }

                const title = line.match(
                    /^(?:题目|试题|问题)\s*[:：]\s*(.+)$/
                );

                if (title) {
                    if (fallback) {
                        bank.push(makeBankItem(fallback, bank.length + 1));
                    }

                    fallback = {
                        parts: [title[1].trim()],
                        options: [],
                        answer: '',
                        answerType: '未识别'
                    };

                    continue;
                }

                if (fallback && isOptionLine(line)) {
                    fallback.options.push(line);
                } else if (fallback) {
                    fallback.parts.push(line);
                }
            }

            if (fallback) {
                bank.push(makeBankItem(fallback, bank.length + 1));
            }
        }

        return bank;
    }

    function makeBankItem(current, id) {
        const question = current.parts.join(' ').trim();
        const options = current.options.slice();

        return {
            id,
            question,
            options,
            answer: current.answer || '',
            answerType: current.answerType || '未识别',
            normalized: normalize(question),
            fullNormalized: normalize(question + ' ' + options.join(' '))
        };
    }

    // ==================== 读取网页文字 ====================

    function readPageText() {
        // 优先使用网页主体的可见文字
        const main = document.querySelector('main, article, [role="main"]');

        let text = '';

        if (main && main.innerText && main.innerText.trim().length > 20) {
            text = main.innerText;
        } else {
            text = document.body?.innerText || '';
        }

        return text
            .split('\n')
            .map(line => line.trim())
            .filter(Boolean)
            .join('\n')
            .slice(0, MAX_PAGE_CHARS);
    }

    // ==================== 快速相似度匹配 ====================

    function getFeatures(text) {
        const s = normalize(text);

        if (featureCache.has(s)) {
            return featureCache.get(s);
        }

        const grams = new Set();

        for (let i = 0; i < s.length; i++) {
            grams.add(s.slice(i, i + 1));

            if (i + 1 < s.length) {
                grams.add(s.slice(i, i + 2));
            }
        }

        if (featureCache.size > 10000) {
            featureCache.clear();
        }

        featureCache.set(s, grams);
        return grams;
    }

    function similarity(a, b) {
        const A = normalize(a);
        const B = normalize(b);

        if (!A || !B) return 0;
        if (A === B) return 1;

        if (A.length >= 6 && B.includes(A)) return 0.99;
        if (B.length >= 6 && A.includes(B)) return 0.96;

        const setA = getFeatures(A);
        const setB = getFeatures(B);

        const small = setA.size <= setB.size ? setA : setB;
        const large = small === setA ? setB : setA;

        let intersection = 0;

        for (const item of small) {
            if (large.has(item)) intersection++;
        }

        const union = setA.size + setB.size - intersection;
        const jaccard = union ? intersection / union : 0;

        const lengthRatio =
            Math.min(A.length, B.length) /
            Math.max(A.length, B.length, 1);

        return jaccard * 0.85 + lengthRatio * 0.15;
    }

    function getCandidates(text) {
        const lines = String(text || '')
            .split('\n')
            .map(line => line.trim())
            .filter(Boolean);

        const candidates = [];
        const seen = new Set();

        function add(value) {
            value = String(value || '').trim();

            if (value.length < 3 || value.length > 1200) return;

            const key = normalize(value);

            if (!key || seen.has(key)) return;

            seen.add(key);
            candidates.push({
                text: value,
                normalized: key
            });
        }

        for (let i = 0; i < lines.length; i++) {
            add(lines[i]);

            // 合并相邻行，兼容换行的题干
            if (i + 1 < lines.length) {
                add(lines[i] + ' ' + lines[i + 1]);
            }

            if (i + 2 < lines.length) {
                add(lines[i] + ' ' + lines[i + 1] + ' ' + lines[i + 2]);
            }

            if (candidates.length >= MAX_CANDIDATES) break;
        }

        return candidates;
    }

    function findBestMatch(pageText) {
        if (!questionBank.length) return null;

        const candidates = getCandidates(pageText);

        // 保留整页作为候选，防止题干被拆行
        candidates.unshift({
            text: pageText.slice(0, MAX_PAGE_CHARS),
            normalized: normalize(pageText)
        });

        let best = null;
        let bestScore = -1;

        for (const q of questionBank) {
            let questionBestScore = 0;
            let matchedText = '';

            for (const candidate of candidates) {
                let score = similarity(
                    q.normalized,
                    candidate.normalized
                );

                // 题干分数偏低时，再参考题干与选项的整体相似度
                if (score < 0.72 && q.fullNormalized !== q.normalized) {
                    const fullScore = similarity(
                        q.fullNormalized,
                        candidate.normalized
                    );

                    score = Math.max(score, fullScore * 0.96);
                }

                if (score > questionBestScore) {
                    questionBestScore = score;
                    matchedText = candidate.text;
                }

                if (questionBestScore >= 0.99) break;
            }

            if (questionBestScore > bestScore) {
                bestScore = questionBestScore;

                best = {
                    ...q,
                    score: questionBestScore,
                    matchedText
                };
            }

            // 精确命中时可以提前结束
            if (bestScore >= 0.99) break;
        }

        // 关键修改：不再用 MIN_SCORE 过滤低相似度结果
        // 只要题库里有题，就返回最高匹配项
        return best;
    }

    // ==================== 显示答案和题库原题 ====================

    function showResult(item) {
        const answerEl = document.getElementById('qbh-answer');
        const questionEl = document.getElementById('qbh-original');
        const optionsEl = document.getElementById('qbh-options');
        const scoreEl = document.getElementById('qbh-score');

        answerEl.textContent = '';
        questionEl.textContent = '';
        optionsEl.textContent = '';
        scoreEl.textContent = '';

        if (!item) {
            answerEl.textContent = '请先导入题库';
            answerEl.style.color = '#b45309';
            questionEl.textContent = '';
            return;
        }

        // 不论匹配度高低，都显示最高匹配项的答案
        if (item.answer) {
            answerEl.textContent = item.answer;
            answerEl.style.color = '#15803d';
        } else {
            answerEl.textContent = '题库未解析到答案';
            answerEl.style.color = '#b45309';
        }

        // 显示题库中的原题
        questionEl.textContent = `题库第 ${item.id} 题：${item.question}`;

        // 显示题库原题的全部选项
        if (item.options && item.options.length) {
            optionsEl.textContent = item.options.join('\n');
        }

        scoreEl.textContent =
            `最高匹配度：${(item.score * 100).toFixed(1)}%`;
    }

    // ==================== 执行读取与匹配 ====================

    async function runMatching() {
        if (busy) return;

        if (!questionBank.length) {
            setStatus('请先导入 Word 题库。');
            return;
        }

        busy = true;
        setStatus('正在读取网页并匹配……');

        try {
            await new Promise(resolve => requestAnimationFrame(resolve));

            const pageText = readPageText();

            if (!pageText.trim()) {
                setStatus('网页没有读取到文字，请确认题目已加载。');
                return;
            }

            const best = findBestMatch(pageText);

            showResult(best);

            if (best) {
                setStatus(
                    `匹配完成。已显示最高匹配项：题库第 ${best.id} 题。`
                );
            } else {
                setStatus('题库中没有可供比较的题目。');
            }
        } catch (error) {
            console.error('[练习题库助手]', error);
            setStatus('处理发生错误：' + (error.message || '未知错误'));
        } finally {
            busy = false;
        }
    }

    // ==================== 导入 DOCX ====================

    function loadMammoth() {
        if (window.mammoth) return Promise.resolve(window.mammoth);
        if (mammothPromise) return mammothPromise;

        mammothPromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');

            script.src =
                'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.8.0/mammoth.browser.min.js';

            script.onload = () => {
                if (window.mammoth) {
                    resolve(window.mammoth);
                } else {
                    reject(new Error('Word 解析组件加载失败'));
                }
            };

            script.onerror = () => {
                reject(new Error('无法加载 Word 解析组件，请检查网络'));
            };

            document.head.appendChild(script);
        });

        return mammothPromise;
    }

    async function importWord(file) {
        if (!file) return;

        if (!file.name.toLowerCase().endsWith('.docx')) {
            setStatus('请选择 .docx 格式的 Word 文件。');
            return;
        }

        setStatus('正在导入 Word 题库……');

        try {
            const mammoth = await loadMammoth();
            const buffer = await file.arrayBuffer();

            const result = await mammoth.extractRawText({
                arrayBuffer: buffer
            });

            const bank = parseBank(result.value || '');

            if (!bank.length) {
                setStatus(
                    '没有识别到题目。建议每道题使用“1. 题干”编号，并将答案独立写成“答案：……”'
                );
                return;
            }

            questionBank = bank;
            featureCache.clear();

            // 预先计算题库特征，提高后续匹配速度
            for (const q of questionBank) {
                getFeatures(q.normalized);
                getFeatures(q.fullNormalized);
            }

            setStatus(`导入成功：${file.name}，共识别 ${bank.length} 道题。`);
            showResult(null);
        } catch (error) {
            console.error(error);
            setStatus('导入失败：' + (error.message || '未知错误'));
        }
    }

    // ==================== 界面 ====================

    const style = document.createElement('style');

    style.textContent = `
        #qbh-panel {
            position: fixed;
            right: 18px;
            top: 100px;
            width: 340px;
            max-width: calc(100vw - 24px);
            max-height: calc(100vh - 30px);
            overflow-y: auto;
            z-index: 2147483647;
            background: #fff;
            color: #222;
            border: 1px solid #d1d5db;
            border-radius: 12px;
            box-shadow: 0 6px 28px rgba(0,0,0,.2);
            font: 14px/1.5 Arial, "Microsoft YaHei", sans-serif;
        }

        #qbh-panel * {
            box-sizing: border-box;
        }

        #qbh-head {
            background: #f3f4f6;
            padding: 10px 12px;
            font-weight: bold;
            display: flex;
            align-items: center;
            justify-content: space-between;
            cursor: move;
            user-select: none;
        }

        #qbh-panel button {
            cursor: pointer;
            border: 1px solid #d1d5db;
            border-radius: 6px;
            padding: 8px 10px;
            background: #fff;
            color: #222;
            font-size: 12px;
        }

        #qbh-panel button:hover {
            background: #f3f4f6;
        }

        #qbh-body {
            padding: 12px;
        }

        #qbh-import {
            width: 100%;
            margin-bottom: 8px;
        }

        #qbh-run {
            width: 100%;
            background: #2563eb !important;
            color: white !important;
            border-color: #2563eb !important;
            padding: 10px !important;
            font-weight: bold;
        }

        #qbh-status {
            margin-top: 9px;
            font-size: 11px;
            color: #6b7280;
            overflow-wrap: anywhere;
        }

        #qbh-answer-box {
            margin-top: 12px;
            border: 1px solid #e5e7eb;
            border-radius: 9px;
            padding: 12px;
            background: #f9fafb;
        }

        #qbh-answer-label {
            text-align: center;
            font-size: 12px;
            color: #6b7280;
        }

        #qbh-answer {
            font-size: 28px;
            font-weight: bold;
            margin: 8px 0;
            text-align: center;
            overflow-wrap: anywhere;
            white-space: pre-wrap;
        }

        #qbh-score {
            font-size: 12px;
            color: #2563eb;
            font-weight: bold;
            margin-bottom: 12px;
        }

        #qbh-original-title {
            font-weight: bold;
            margin-bottom: 6px;
        }

        #qbh-original {
            font-size: 13px;
            line-height: 1.7;
            white-space: pre-wrap;
            overflow-wrap: anywhere;
        }

        #qbh-options {
            font-size: 12px;
            line-height: 1.7;
            color: #4b5563;
            margin-top: 8px;
            white-space: pre-wrap;
            overflow-wrap: anywhere;
        }

        #qbh-close {
            border: none !important;
            font-size: 18px !important;
            padding: 0 5px !important;
        }
    `;

    document.documentElement.appendChild(style);

    const panel = document.createElement('div');
    panel.id = 'qbh-panel';

    panel.innerHTML = `
        <div id="qbh-head">
            <span>练习题库助手</span>
            <button id="qbh-close" title="关闭">×</button>
        </div>

        <div id="qbh-body">
            <button id="qbh-import">导入 Word 题库（.docx）</button>
            <input id="qbh-file" type="file" accept=".docx" hidden>

            <button id="qbh-run">读取并匹配</button>

            <div id="qbh-status">请先导入 Word 题库。</div>

            <div id="qbh-answer-box">
                <div id="qbh-answer-label">最高匹配项的答案</div>
                <div id="qbh-answer">—</div>
                <div id="qbh-score"></div>

                <div id="qbh-original-title">题库原题</div>
                <div id="qbh-original"></div>
                <div id="qbh-options"></div>
            </div>
        </div>
    `;

    document.documentElement.appendChild(panel);

    document.getElementById('qbh-import').addEventListener('click', () => {
        document.getElementById('qbh-file').click();
    });

    document.getElementById('qbh-file').addEventListener('change', async event => {
        await importWord(event.target.files?.[0]);
        event.target.value = '';
    });

    document.getElementById('qbh-run').addEventListener('click', runMatching);

    document.getElementById('qbh-close').addEventListener('click', () => {
        panel.remove();
        style.remove();
    });

    // ==================== 拖动面板 ====================

    const head = document.getElementById('qbh-head');

    let dragging = false;
    let startX = 0;
    let startY = 0;
    let initialLeft = 0;
    let initialTop = 0;

    head.addEventListener('mousedown', event => {
        if (event.target.closest('button')) return;

        const rect = panel.getBoundingClientRect();

        dragging = true;
        startX = event.clientX;
        startY = event.clientY;
        initialLeft = rect.left;
        initialTop = rect.top;

        panel.style.left = initialLeft + 'px';
        panel.style.top = initialTop + 'px';
        panel.style.right = 'auto';

        event.preventDefault();
    });

    document.addEventListener('mousemove', event => {
        if (!dragging) return;

        const left = Math.max(
            0,
            Math.min(
                window.innerWidth - panel.offsetWidth,
                initialLeft + event.clientX - startX
            )
        );

        const top = Math.max(
            0,
            Math.min(
                window.innerHeight - 50,
                initialTop + event.clientY - startY
            )
        );

        panel.style.left = left + 'px';
        panel.style.top = top + 'px';
    });

    document.addEventListener('mouseup', () => {
        dragging = false;
    });

})();