               className="sentence-panel fixed right-0 top-14 bottom-0 w-[380px] max-w-full bg-card border-l border-border flex flex-col z-30 shadow-xl">
              <div className="flex items-center justify-between px-4 pt-4 pb-0 shrink-0">
                <div className="flex gap-1 bg-muted p-1 rounded-xl">
                   <button data-testid="button-sentence-translation-tab" onClick={() => setPanelTab('translate')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${panelTab === 'translate' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
                    <Languages size={14} /> Перевод
                  </button>
                   <button data-testid="button-sentence-grammar-tab" onClick={() => setPanelTab('grammar')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${panelTab === 'grammar' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
                    <Microscope size={14} /> Грамматика
                  </button>
                </div>
               <button data-testid="button-close-sentence-panel" aria-label="Закрыть панель предложения" onClick={closeSentencePanel} className="p-1.5 rounded-full hover:bg-muted text-muted-foreground hover:text-foreground ml-2">
                  <X size={16} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                <div className="bg-muted/50 rounded-xl p-3">
                  <p className="text-xs text-muted-foreground font-medium mb-1 uppercase tracking-wide">Оригинал</p>
                  <p className="text-sm text-foreground/90 leading-relaxed font-serif italic">{selectedSentence}</p>
                </div>
                {panelTab === 'translate' && (
                  <div>
                    <p className="text-xs text-muted-foreground font-medium mb-1.5 uppercase tracking-wide">Перевод</p>
                    {translating
                      ? <div className="flex items-center gap-2 text-muted-foreground text-sm p-3"><Loader2 size={16} className="animate-spin" />Переводим…</div>
                      : <p className="text-sm text-foreground leading-relaxed bg-primary/5 rounded-xl p-3 border border-primary/10">{sentenceTranslation}</p>
                    }
                  </div>
                )}
                {panelTab === 'grammar' && sentenceGrammar && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="bg-muted/60 rounded-xl p-3">
                        <p className="text-xs text-muted-foreground mb-1">Тип</p>
                        <p className="text-sm font-semibold">{sentenceGrammar.sentenceType}</p>
                      </div>
                      <div className="bg-muted/60 rounded-xl p-3">
                        <p className="text-xs text-muted-foreground mb-1">Время</p>
                        <p className="text-sm font-semibold text-primary">{sentenceGrammar.tense}</p>
                      </div>
                    </div>
                    <div className="bg-muted/60 rounded-xl p-3">
                      <p className="text-xs text-muted-foreground mb-1">Залог</p>
                      <p className="text-sm font-semibold">{sentenceGrammar.voice}</p>
                    </div>
                    {sentenceGrammar.constructions.length > 0 && (
                      <div className="bg-muted/60 rounded-xl p-3">
                        <p className="text-xs text-muted-foreground mb-2">Конструкции</p>
                        <ul className="space-y-1">
                          {sentenceGrammar.constructions.map((c, i) => (
                            <li key={i} className="text-sm text-foreground/85 flex items-start gap-2">
                              <span className="text-primary mt-0.5 shrink-0">•</span>{c}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {sentenceGrammar.tip && (
                      <div className="bg-primary/5 border border-primary/15 rounded-xl p-3">
                         <p className="text-xs text-primary font-medium mb-1">{sentenceGrammar.tense}</p>
                        <p className="text-xs text-foreground/80 leading-relaxed">{sentenceGrammar.tip}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </motion.aside>
          )}
        </AnimatePresence>
      </div>

      <footer className="h-9 shrink-0 flex items-center justify-center gap-3 text-xs text-muted-foreground border-t border-border/30">
        <button data-testid="button-reader-footer-prev" aria-label="Предыдущая страница" onClick={handlePrev} disabled={currentPageIdx === 0} className="p-1 hover:text-foreground disabled:opacity-30 transition-colors"><ChevronLeft size={14} /></button>
        {editingPage ? (
          <form onSubmit={handleJumpSubmit} className="flex items-center gap-1">
           <input data-testid="input-reader-page" autoFocus type="number" min={1} max={pages.length} value={jumpValue}
              onChange={e => setJumpValue(e.target.value)}
              onBlur={() => { setEditingPage(false); setJumpValue(''); }}
              className="w-16 text-center text-xs border border-border rounded px-2 py-0.5 bg-background focus:outline-none focus:ring-1 focus:ring-primary/50" />
            <span>/ {pages.length}</span>
          </form>
        ) : (
           <button data-testid="button-reader-page-number" onClick={() => { setEditingPage(true); setJumpValue(String(currentPageIdx + 1)); }}
            className="hover:text-foreground transition-colors hover:bg-muted px-2 py-0.5 rounded" title="Нажмите для перехода">
             <span data-testid="text-reader-page">Страница {currentPageIdx + 1} из {pages.length}</span>
          </button>
        )}
        <button data-testid="button-reader-footer-next" aria-label="Следующая страница" onClick={handleNext} disabled={currentPageIdx === pages.length - 1} className="p-1 hover:text-foreground disabled:opacity-30 transition-colors"><ChevronRight size={14} /></button>
      </footer>

      {/* Word tooltip */}
      <AnimatePresence>
        {tooltip && (
          <WordTooltip
            state={tooltip}
            onMouseEnter={() => clearTimeout(hideTimeoutRef.current)}
            onMouseLeave={handleWordMouseLeave}
            onClose={() => {
              clearTimeout(hoverTimeoutRef.current);
              clearTimeout(hideTimeoutRef.current);
              setTooltip(null);
            }}
            onAdd={handleAddWord}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
