/**
 * @summary Container is a main god object that connect server, document, statusbar, iframe
 * @author Vincent B. <evilznet@gmail.com>
 */
import {
  commands,
  ConfigurationChangeEvent,
  TextDocument,
  TextDocumentChangeEvent,
  TextEditor,
  TextEditorSelectionChangeEvent,
  Webview
} from 'vscode'

import * as path from 'path'

import { debounce } from 'lodash'
import { SHOW_REVEALJS } from './commands/showRevealJS'
import { Configuration, getDocumentOptions } from './Configuration'
import { extensionId } from './constants'
import { EditorContext } from './EditorContext'
import { saveContent } from './ExportHTML'
import { ISlide } from './ISlide'
import { RevealServer } from './RevealServer'
import { SlideTreeProvider } from './SlideExplorer'
import { StatusBarController } from './StatusBarController'

export default class Container {
  private readonly server: RevealServer
  private readonly statusBarController: StatusBarController
  private readonly slidesExplorer: SlideTreeProvider
  private editorContext: EditorContext | null
  private _configuration: Configuration
  private webView: Webview | null

  public onDidChangeTextEditorSelection(event: TextEditorSelectionChangeEvent) {
    if (this.editorContext === null) {
      return
    }
    if (event.textEditor !== this.editorContext.editor || event.selections.length === 0) {
      return
    }

    const end = event.selections[0].active
    this.editorContext.updatePosition(end)

    this.refreshWebView()
    // this.iframeProvider.update()
    this.editorContext.refresh() // dont change this order !!!!!!
    this.statusBarController.update()
    this.slidesExplorer.update()
  }

  public onDidChangeActiveTextEditor(editor: TextEditor | undefined): any {
    if (editor && editor.document.languageId === 'markdown') {
      this.editorContext = new EditorContext(editor, getDocumentOptions(this.configuration))
    }
    this.server.start()
    this.server.refresh()
    this.refreshWebView()
    this.statusBarController.update()
    this.slidesExplorer.update()
  }

  public onDidChangeTextDocument(e: TextDocumentChangeEvent) {
    console.log('onDidChangeTextDocument')
  }

  public onDidSaveTextDocument(e: TextDocument) {
    console.log('onDidSaveTextDocument')
  }

  public onDidCloseTextDocument(e: TextDocument) {
    console.log('onDidCloseTextDocument')
  }

  public onDidChangeConfiguration(e: ConfigurationChangeEvent) {
    if (!e.affectsConfiguration(extensionId)) {
      return
    }

    this._configuration = this.loadConfiguration()
  }

  public constructor(private readonly loadConfiguration: () => Configuration) {
    this._configuration = this.loadConfiguration()

    this.editorContext = null

    this.server = new RevealServer(
      () => this.rootDir,
      () => this.slideContent,
      () => this.configuration,
      () => this.isInExport,
      (req, data) => this.saveHtmlFn(req, data)
    )

    this.statusBarController = new StatusBarController(() => this.server.uri, () => this.slideCount)
    this.statusBarController.update()

    this.slidesExplorer = new SlideTreeProvider(() => this.slides)
    this.slidesExplorer.register()
  }

  private get rootDir() {
    if (this.editorContext) {
      return this.editorContext.dirname
    }
    return ''
  }
  private get slideContent() {
    if (this.editorContext) {
      return this.editorContext.slideContent
    }
    return null
  }
  public get configuration() {
    return this.editorContext !== null && this.editorContext.hasfrontConfig
      ? // tslint:disable-next-line:no-object-literal-type-assertion
        ({ ...this._configuration, ...this.editorContext.documentOptions } as Configuration)
      : this._configuration
  }

  private exportPromiseResolve: (value?: string | PromiseLike<string>) => void
  private exportPromiseReject: (reason?: any) => void
  private endDebounce: (() => void) | null = null

  get isInExport() {
    if (this.exportPromise === null) {
      return false
    }
    if (this.endDebounce !== null) {
      this.endDebounce()
    }

    return this.exportPromise !== null
  }

  private exportPromise: Promise<string> | null = null

  public startExport() {
    if (this.exportPromise === null) {
      this.exportPromise = new Promise<string>((resolve, reject) => {
        this.exportPromiseResolve = resolve
        this.exportPromiseReject = reject
      })

      this.endDebounce = debounce(() => {
        if (this.exportPromise && this.exportPromiseResolve) {
          this.exportPromiseResolve(this.exportPath)
          this.exportPromise = null
          this.endDebounce = null
        }
      }, 800)
    }

    this.webView ? this.refreshWebView() : commands.executeCommand(SHOW_REVEALJS)
    return this.exportPromise
  }

  private readonly saveHtmlFn = (url: string, data: string) => saveContent(() => this.exportPath, url, data)

  get slides(): ISlide[] {
    return this.editorContext === null ? [] : this.editorContext.slides
  }

  get slideCount(): number {
    return this.editorContext === null ? 0 : this.editorContext.slideCount
  }

  public getUri(withPosition = true): string | null {
    if (!this.server.isListening || this.editorContext === null) {
      return null
    }

    const serverUri = this.server.uri
    const slidepos = this.editorContext.position

    return withPosition ? `${serverUri}#/${slidepos.horizontal}/${slidepos.vertical}/${Date.now()}` : `${serverUri}`
  }

  public isMarkdownFile() {
    return this.editorContext === null ? false : this.editorContext.isMarkdownFile
  }

  public goToSlide(topindex: number, verticalIndex: number) {
    if (this.editorContext !== null) {
      this.editorContext.goToSlide(topindex, verticalIndex)
    }

    this.refreshWebView()
  }

  public stopServer() {
    this.server.stop()
    this.statusBarController.update()
  }

  public get exportPath() {
    return this.configuration.exportHTMLPath ? this.configuration.exportHTMLPath : path.join(this.rootDir, 'export')
  }

  public refreshWebView(view?: Webview) {
    if (view) {
      this.webView = view
    }

    if (this.webView) {
      this.webView.html = `<style>html, body, iframe { height: 100% }</style>
      <iframe src="${this.getUri()}" frameBorder="0" style="width: 100%; height: 100%" />`
    }
  }
}
