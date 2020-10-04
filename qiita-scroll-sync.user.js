// ==UserScript==
// @name         Qiita同時スクロール
// @version      0.1
// @description  Qiitaの投稿画面のエディター(左)・プレビュー(右)の同時スクロールを改善し、各見出しを基準にスクロール位置を合わせるようにする。
// @author       fukuchan
// @match        *://*.qiita.com/drafts/new
// @match        *://*.qiita.com/drafts/*/edit*
// @run-at       document-start
// ==/UserScript==

// あらかじめaddEventListenerを上書きして既存のscrollイベントが設定されるのを阻止する
Document.prototype._addEventListener = Document.prototype.addEventListener;
Document.prototype.addEventListener = function (type, listener, useCapture = false) {
    if (type === "scroll") {
        return;
    }
    this._addEventListener(type, listener, useCapture);
};

// ロード後に実行
window.addEventListener("DOMContentLoaded", () => {
    // エディターを取得
    const editor = document.querySelector(".editorMarkdown_textarea");

    // エディターのスタイルを取得
    const style = getComputedStyle(editor);
    const lineHeight = style.lineHeight ? parseFloat(style.lineHeight) : 21;
    const padding = style.padding ? parseFloat(style.padding) : 10;

    const textarea = createTextareaForCalculating(style, padding, lineHeight);
    document.querySelector(".editorMarkdown_textareaWrapper").append(textarea);

    const handleWheel = makeWheelHandler(editor, padding, lineHeight);

    const handleScroll = makeScrollHandler(editor);

    const handleInput = makeInputHandler(editor, padding, handleScroll);

    const handleMutation = makeMutationHandler(editor, textarea, padding, handleScroll);

    // エディタに各イベントリスナを設定する
    editor.addEventListener("wheel", handleWheel);
    editor.addEventListener("scroll", handleScroll);
    editor.addEventListener("input", handleInput);

    // プレビューの変更・レイアウトの変更・ウィンドウのリサイズを監視
    new MutationObserver(handleMutation).observe(document.querySelector(".editorPreview"), {
        childList: true,
        subtree: true
    });
    window.addEventListener("resize", handleMutation);
});

function calcDeltaY(e, editor, lineHeight) {
    if (e.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
        return editor.clientHeight;
    }
    if (e.deltaMode === WheelEvent.DOM_DELTA_LINE) {
        return e.deltaY * lineHeight;
    }
    return e.deltaY;
}

// スクロールの下限をなくすように見せかける
const makeWheelHandler = (editor, padding, lineHeight) => e => {
    if (editor.scrollTop === editor.scrollHeight - editor.clientHeight) {
        // スクロール末尾でなおスクロールしようとしている場合
        const y = editor.style.paddingBottom ? parseFloat(editor.style.paddingBottom) : padding;
        const deltaY = calcDeltaY(e, editor, lineHeight);
        const sum = y + deltaY;
        if (deltaY < 0 || sum < editor.clientHeight) {
            // padding-bottomを増やしてスクロールしているように見せかける
            editor.style.paddingBottom = sum + "px";
            editor.scrollTop = editor.scrollHeight - editor.clientHeight;
        }
        return;
    } 
    if (parseFloat(editor.style.paddingBottom) !== padding) {
        editor.style.paddingBottom = padding + "px";
    }
};


// エディタにpadding-bottomを設定しているのをごまかす
const makeInputHandler = (editor, padding, handleScroll) => () => {
    if (editor.style.paddingBottom) {
        const paddingBottom = parseFloat(editor.style.paddingBottom);
        // padding-bottomが設定されている場合
        if (paddingBottom > padding) {
            // 入力時にpadding-bottomを調整して、パディングの中に文字列が隠れるのを防止する
            const deltaY = editor.scrollTop - editor.scrollHeight + editor.clientHeight;
            const y = paddingBottom + deltaY > padding ? paddingBottom + deltaY : padding;
            editor.style.paddingBottom = y + "px";
        }
    }
    const viewer = document.querySelector(".editorPreview_article");
    if (viewer) {
        // 入力のたびにプレビューのスクロール位置が0にされるのを無理やり修正
        const disableScroll = () => {
            // スクロール位置を再計算し、一度再計算したらイベントリスナを削除する
            handleScroll();
            viewer.removeEventListener("scroll", disableScroll);
        };
        viewer.addEventListener("scroll", disableScroll);
    }
};

// 見出し座標計算用のテキストエリアを作る
function createTextareaForCalculating(style, padding, lineHeight) {
    const textarea = document.createElement("textarea");
    Array.from(style).forEach(key => textarea.style.setProperty(key, style.getPropertyValue(key), style.getPropertyPriority(key)));
    textarea.style.pointerEvents = "none";
    textarea.style.visibility = "hidden";
    textarea.style.position = "absolute";
    textarea.style.top = "0";
    textarea.style.left = "0";
    textarea.style.width = "100%";
    textarea.style.height = (padding * 2 + lineHeight) + "px";
    textarea.readOnly = true;
    return textarea;
}

function calcScroll(x, y, editorScrollTop) {
    const i = x.findIndex((value) => value <= editorScrollTop);
    if (i === 0) {return 0}
    if (i === x.length - 1 || i === -1) {return y[y.length - 1];}

    return  (y[i + 1] - y[i]) / (x[i + 1] - x[i]) * (editorScrollTop - x[i]) + y[i];
}

// 見出しに合わせてスクロールする
const makeScrollHandler = (editor) =>() => {
    const viewer = document.querySelector(".editorPreview_article");
    if (!viewer) {
        // プレビュー非表示モードなら何もしない
        return;
    }

    // 座標が未設定ならなにもしない
    if (!editor.dataset.coordinates || !viewer.dataset.coordinates) {
        return;
    }

    // datasetから各見出しの座標を取得
    const x = JSON.parse(editor.dataset.coordinates);
    const y = JSON.parse(viewer.dataset.coordinates);

    // 線形補完でプレビューのスクロール位置を計算
    viewer.scrollTop = calcScroll(x, y, editor.scrollTop);
};

// プレビューの変更時に見出しの座標を計算する
const makeMutationHandler = (editor, textarea, padding, handleScroll) => async () => {
    const viewer = document.querySelector(".editorPreview_article");
    if (!viewer) {
        // プレビュー非表示モードなら何もしない
        return;
    }
    const target = viewer.children[0];

    // エディターにおける各見出し位置を求める
    const xCoordinates = getXCoordinates(editor, textarea, padding);

    // プレビューにおける各見出し位置を求める
    const yCoordinates = await getYCoordinates(target, viewer.scrollHeight);

    // 座標をdata-coordinatesに設定
    editor.dataset.coordinates = JSON.stringify(xCoordinates);
    viewer.dataset.coordinates = JSON.stringify(yCoordinates);

    // プレビューの下に空白を追加
    target.style.marginBottom = viewer.clientHeight + "px";

    // スクロール位置を修正
    handleScroll();
};

// 画像の読み込みを待機
function waitToLoadImages(target) {
    const images = Array.from(target.querySelectorAll("img"));

    return new Promise(resolve => {
        const intervalID = setInterval(() => {
            // naturalHeightが0より大きくなれば読み込み完了と推測
            if (images.every(image => image.naturalHeight > 0)) {
                // ループを終了
                clearInterval(intervalID);
                resolve();
            }
        }, 10);
    });
}

function getXCoordinates(editor, textarea, padding) {
    // 見出しで文章を分割
    const re = /(?=^(?:> ?)?#+)/gm;
    const paragraphs = editor.value.split(re);
    const xCoordinates = paragraphs.map((_, i) => {
        // 計算用テキストエリアに入力、テキストエリアの高さから見出し位置を求める
        textarea.value = paragraphs.slice(0, i + 1).join("");
        return textarea.scrollHeight - padding * 2;
    });

    // スクロール先頭の座標を追加
    if (paragraphs[0].match(re)) {
        xCoordinates.unshift(0);
    }
    xCoordinates.unshift(0);

    return xCoordinates;
}

async function getYCoordinates(target, trailingY) {
    target.querySelectorAll("details").forEach(node => (node.open = true));
    target.querySelectorAll("img").forEach(node => (node.loading = "eager"));

    await waitToLoadImages(target);

    // 見出し位置を求める
    const headers = target.querySelectorAll("h1,h2,h3,h4,h5,h6");
    const yCoordinates = Array.from(headers).map(header => header.offsetTop);

    // スクロールの先頭と末尾の座標を追加
    yCoordinates.unshift(0);
    yCoordinates.push(trailingY);

    return yCoordinates;
}
