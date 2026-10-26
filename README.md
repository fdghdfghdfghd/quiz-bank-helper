# 练习题库助手 · quiz-bank-helper

一个 **Tampermonkey（油猴）用户脚本**：导入你自己的 `.docx` 题库，在答题网页上点一下，就把**匹配度最高的那道题**的答案、原题和选项显示在页面的悬浮面板里。

> 它只「看」和「显示」——**不自动点击、不自动填写、不自动提交**。最后那一下永远是你自己按。

**安装**：打开 [`quiz-bank-helper.user.js`](quiz-bank-helper.user.js) → 点右上角 **Raw** → 油猴会自动弹出安装页。

---

## 它解决什么问题

对着屏幕答题时，题库在另一个 Word 文件里，来回切窗口、`Ctrl+F`、肉眼比对，很烦。

这个脚本把这一串动作压缩成**一次点击**，并且把**匹配度**一起显示出来——让你自己判断这个答案可不可信，而不是无脑信它。

## 安装

1. 浏览器装 [Tampermonkey](https://www.tampermonkey.net/)（油猴扩展）
2. 打开本仓库的 [`quiz-bank-helper.user.js`](quiz-bank-helper.user.js)
3. 点右上角 **Raw**
4. 油猴会弹出安装页 → 点 **安装**

装完随便打开一个网页，右上角应该出现「练习题库助手」面板。

## 使用（四步）

1. **打开答题网页** —— 面板在右上角自动出现
2. 点 **导入 Word 题库（.docx）**，选你的题库文件
   （首次导入需要联网：要从 CDN 加载 Word 解析库 `mammoth`）
3. 点 **读取并匹配**
4. 看面板：

| 位置 | 内容 |
|---|---|
| 大号绿字 | **最高匹配项的答案** |
| 蓝色小字 | `最高匹配度：xx%` |
| 「题库原题」下 | 题库里那道题的完整题干 |
| 最下方 | 那道题在题库里的全部选项 |

面板可以按住标题栏拖动，点 `×` 关闭。

## 题库格式

脚本靠「**题号 + 答案行**」来切分题目。推荐长这样：

```
1. 下列哪个是 HTTP 状态码？
A. 200
B. 404
C. 302
D. 500
答案：B

2. 下列哪些属于前端技术？（多选）
A. HTML
B. CSS
C. MySQL
D. JavaScript
答案：ABD
```

识别规则：

| 行的类型 | 要求 |
|---|---|
| **题目行** | 以 `1.` / `1、` / `(1)` / `第1题` 这类编号开头 |
| **选项行** | 以 `A`~`D` 开头，**后面必须跟分隔符**：`.` `、` `:` `)` 都行 |
| **答案行** | 以 `答案` / `答` / `正确答案` / `标准答案` 开头，后面可跟 `：` `:` `、` |
| **单选** | 写 `B` |
| **多选** | 写 `AB` / `A,B` / `A、B` |
| **判断 / 填空** | 直接写文字，例如 `正确`、`错误`、你的答案原文 |

完整示例见 [`examples/sample-bank.txt`](examples/sample-bank.txt)。

## 匹配是怎么算的

1. 把当前页面**可见文字**按行切开，并合并相邻的行（防止题干被换行拆断）
2. 对题库里每一道题、每个候选片段算相似度：
   - 双边归一化：去空白、去标点、全角转半角、转小写
   - 字符级 1-gram + 2-gram 的 **Jaccard 相似度 × 0.85**
   - 加上**长度比例 × 0.15**
   - 题干**原样出现**在页面里 → 直接判 **0.99**
3. 取总分最高的那道题，把答案显示出来

## 已知限制（用之前请知道）

- **没有匹配阈值**。题库里没有这道题时，它照样会显示「最像的那道」的答案，只是匹配度会很低。**看到低匹配度一定要自己核实**。
- **一页多题时会偏向题库里靠前的题**。整页文本也参与比较，题干原文命中就 0.99 并提前结束比较。答题时建议一次只让屏幕上有一道题，并且**用面板里的「题库原题」核对是不是同一道**。
- **题库只在内存里**。刷新页面、跳到下一题页，都要**重新导入**。
- **只认 A–D 四个选项**。五选项（A–E）的题，`E` 会被当作普通文字答案显示。
- **选项行必须带分隔符**。`A 选项内容`（只用空格分隔）不会被识别成选项，会并进题干。
- **`@match` 是全站**。面板会出现在**所有**网站上。想只在目标站生效，把脚本开头改成具体域名，例如 `// @match https://example.com/*`。
- **首次导入 Word 需要联网**。要加载 `cdnjs.cloudflare.com` 上的 `mammoth`；国内网络可能打不开，打不开就导入失败。
- **只支持 `.docx`**，老的 `.doc` 不支持。

## 隐私

- 题库、答案、匹配结果**全部留在你的浏览器里**。脚本不上传任何数据，也没有统计上报。
- 唯一的外连是导入 `.docx` 时加载 Word 解析库（公共 CDN）。
- 脚本用 `@grant none`，**不申请**油猴的任何特权 API（`GM_*`）。

## 使用范围

这是**练习、复习、自查**用的工具：题库是你自己的，脚本只是帮你更快查到自己整理过的答案。

在**正式考试、有监考的测评、或平台明确禁止辅助工具**的场景使用，风险（违反平台条款、成绩被判无效等）由使用者自负，与本项目无关。

## 许可证

[MIT](LICENSE)

---

<details>
<summary>English</summary>

A Tampermonkey userscript: import your own `.docx` question bank, click once on a quiz page, and the panel shows the best-matching question's answer, original question and options.

It only reads the page and displays — it never clicks, fills or submits anything. The question bank stays in your browser; nothing is uploaded. The only network call is loading `mammoth` from a public CDN to parse `.docx` files.

MIT licensed. Intended for practice and self-review.
</details>
