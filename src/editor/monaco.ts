import * as monaco from 'monaco-editor'
import { loader } from '@monaco-editor/react'
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'
import JsonWorker from 'monaco-editor/language/json/json.worker?worker'
import CssWorker from 'monaco-editor/language/css/css.worker?worker'
import HtmlWorker from 'monaco-editor/language/html/html.worker?worker'
import TsWorker from 'monaco-editor/language/typescript/ts.worker?worker'
import type { ThemeName } from '@shared/types'

// Bundle Monaco locally (no CDN) so the editor works fully offline.
self.MonacoEnvironment = {
  getWorker(_id: string, label: string) {
    if (label === 'json') return new JsonWorker()
    if (label === 'css' || label === 'scss' || label === 'less') return new CssWorker()
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new HtmlWorker()
    if (label === 'typescript' || label === 'javascript') return new TsWorker()
    return new EditorWorker()
  }
}

loader.config({ monaco })

monaco.editor.defineTheme('localcode-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#1e1e1e',
    'editor.foreground': '#d4d4d4',
    'editorLineNumber.foreground': '#6e7681',
    'editorLineNumber.activeForeground': '#cccccc',
    'editor.selectionBackground': '#264f78',
    'editor.lineHighlightBackground': '#ffffff0a',
    'diffEditor.insertedTextBackground': '#9ccc2c33',
    'diffEditor.removedTextBackground': '#ff000033',
    'diffEditor.insertedLineBackground': '#9bb95533',
    'diffEditor.removedLineBackground': '#ff000033'
  }
})

monaco.editor.defineTheme('localcode-light', {
  base: 'vs',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#ffffff',
    'editorLineNumber.foreground': '#237893',
    'editorLineNumber.activeForeground': '#0b216f',
    'diffEditor.insertedTextBackground': '#9ccc2c40',
    'diffEditor.removedTextBackground': '#ff000033',
    'diffEditor.insertedLineBackground': '#9bb95533',
    'diffEditor.removedLineBackground': '#ff000026'
  }
})

monaco.typescript.typescriptDefaults.setCompilerOptions({
  target: monaco.typescript.ScriptTarget.ES2020,
  allowNonTsExtensions: true,
  moduleResolution: monaco.typescript.ModuleResolutionKind.NodeJs,
  module: monaco.typescript.ModuleKind.ESNext,
  jsx: monaco.typescript.JsxEmit.ReactJSX,
  allowJs: true,
  esModuleInterop: true
})
// Workspace files are edited one by one, so suppress "cannot find module" noise.
monaco.typescript.typescriptDefaults.setDiagnosticsOptions({ diagnosticCodesToIgnore: [2307, 2792, 7016] })
monaco.typescript.javascriptDefaults.setDiagnosticsOptions({ diagnosticCodesToIgnore: [2307, 2792, 7016] })

export function monacoTheme(theme: ThemeName): string {
  return theme === 'dark' ? 'localcode-dark' : 'localcode-light'
}

export function modelUri(path: string): monaco.Uri {
  return monaco.Uri.file(path)
}

export function getModel(path: string): monaco.editor.ITextModel | null {
  return monaco.editor.getModel(modelUri(path))
}

/** Replace a model's text as one undoable edit, so Ctrl+Z restores the previous version. */
export function replaceModelText(path: string, text: string): boolean {
  const model = getModel(path)
  if (!model || model.getValue() === text) return !!model
  model.pushStackElement()
  model.pushEditOperations([], [{ range: model.getFullModelRange(), text }], () => null)
  model.pushStackElement()
  return true
}

export function disposeModel(path: string): void {
  getModel(path)?.dispose()
}

export { monaco }
