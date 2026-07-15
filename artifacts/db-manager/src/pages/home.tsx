import React, { useState } from 'react';
import { 
  useTestConnection, 
  useListCollections, 
  useCreateCollection, 
  useSetupAlphaChat,
  getListCollectionsQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff, Database, Plus, CheckCircle2, XCircle, LayoutList, Layers, Zap, AlertCircle, SkipForward } from 'lucide-react';

export default function Home() {
  const queryClient = useQueryClient();
  const [uri, setUri] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [connectedUri, setConnectedUri] = useState('');
  
  // Connection state
  const [dbName, setDbName] = useState('');
  const [host, setHost] = useState('');
  const [connectionError, setConnectionError] = useState('');
  
  // Collection creation state
  const [newCollectionName, setNewCollectionName] = useState('');

  // Setup state
  const [setupResult, setSetupResult] = useState<null | { collections: Array<{name: string; status: string; error: string | null}>; created: number; skipped: number; errors: number }>(null);

  // API Hooks
  const testConnection = useTestConnection();
  const createCollection = useCreateCollection();
  const setupAlphaChat = useSetupAlphaChat();
  const { data: collectionsData, isLoading: isLoadingCollections, isError: isErrorCollections, refetch: refetchCollections } = useListCollections(
    { uri: connectedUri },
    { query: { enabled: !!connectedUri, queryKey: getListCollectionsQueryKey({ uri: connectedUri }) } }
  );

  const handleConnect = (e: React.FormEvent) => {
    e.preventDefault();
    if (!uri) return;
    
    setConnectionError('');
    setDbName('');
    setHost('');
    setConnectedUri('');
    
    testConnection.mutate({ data: { uri } }, {
      onSuccess: (data) => {
        if (data.ok) {
          setConnectedUri(uri);
          setDbName(data.dbName);
          setHost(data.host);
        } else {
          setConnectionError("Connessione fallita.");
        }
      },
      onError: (err: any) => {
        setConnectionError(err?.error || "Errore di connessione al database.");
      }
    });
  };

  const sanitizeCollectionName = (name: string) => {
    return name.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  };

  const handleCreateCollection = (e: React.FormEvent) => {
    e.preventDefault();
    const sanitizedName = sanitizeCollectionName(newCollectionName);
    if (!sanitizedName || !connectedUri) return;
    
    createCollection.mutate({ data: { uri: connectedUri, name: sanitizedName } }, {
      onSuccess: (data) => {
        if (data.ok) {
          setNewCollectionName('');
          queryClient.invalidateQueries({ queryKey: getListCollectionsQueryKey({ uri: connectedUri }) });
        }
      }
    });
  };

  const handleSetup = () => {
    if (!connectedUri) return;
    setSetupResult(null);
    setupAlphaChat.mutate({ data: { uri: connectedUri } }, {
      onSuccess: (data) => {
        setSetupResult(data as any);
        queryClient.invalidateQueries({ queryKey: getListCollectionsQueryKey({ uri: connectedUri }) });
      },
    });
  };

  const isConnected = !!connectedUri;

  return (
    <div className="min-h-screen bg-background text-foreground p-6 md:p-12 lg:px-24 flex justify-center">
      <div className="w-full max-w-4xl space-y-8">
        
        {/* Header */}
        <header className="mb-10">
          <div className="inline-flex items-center gap-3 px-3 py-1.5 rounded-full bg-secondary/50 border border-border/20 mb-6">
            <div className="w-2 h-2 rounded-full alpha-gradient"></div>
            <span className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">Alpha Chat // Internal</span>
          </div>
          <h1 className="text-4xl font-bold tracking-tight mb-2">Database Manager</h1>
          <p className="text-muted-foreground text-lg">Strumento di amministrazione e connessione MongoDB.</p>
        </header>

        {/* 1. CONNECTION SECTION */}
        <section className="bg-card rounded-xl border border-card-border p-6 shadow-xl relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 alpha-gradient"></div>
          
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2 bg-secondary rounded-lg">
              <Database className="w-5 h-5 text-primary" />
            </div>
            <h2 className="text-xl font-semibold">Connessione</h2>
          </div>
          
          <form onSubmit={handleConnect} className="space-y-4">
            <div>
              <label htmlFor="uri" className="block text-sm font-medium text-muted-foreground mb-1.5">
                MongoDB URI
              </label>
              <div className="relative">
                <input
                  id="uri"
                  type={showPassword ? "text" : "password"}
                  value={uri}
                  onChange={(e) => setUri(e.target.value)}
                  placeholder="mongodb+srv://user:pass@cluster.mongodb.net/app_db"
                  className="w-full bg-input border border-border/30 rounded-lg px-4 py-3 pr-12 text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-shadow placeholder:text-muted-foreground/50 font-mono text-sm"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-1"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            
            <div className="flex items-center justify-between pt-2">
              <div className="flex-1">
                {isConnected && !connectionError && !testConnection.isPending && (
                  <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-green-500/10 border border-green-500/20 text-green-400 text-sm">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Connesso &mdash; db: <strong>{dbName}</strong> &mdash; host: <strong>{host}</strong></span>
                  </div>
                )}
                {connectionError && !testConnection.isPending && (
                  <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-sm">
                    <XCircle className="w-4 h-4" />
                    <span>{connectionError}</span>
                  </div>
                )}
              </div>
              
              <button
                type="submit"
                disabled={!uri || testConnection.isPending}
                className="alpha-gradient px-6 py-2.5 rounded-lg text-white font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {testConnection.isPending ? (
                  <>
                    <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin"></div>
                    <span>Connessione...</span>
                  </>
                ) : (
                  <span>Connetti</span>
                )}
              </button>
            </div>
          </form>
        </section>

        {/* SETUP ALPHA CHAT — visible when connected */}
        {isConnected && (
          <section className="bg-card rounded-xl border border-card-border p-6 shadow-lg animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <div className="p-2 bg-secondary rounded-lg">
                    <Zap className="w-5 h-5 text-primary" />
                  </div>
                  <h2 className="text-xl font-semibold">Setup Alpha Chat</h2>
                </div>
                <p className="text-sm text-muted-foreground ml-14">
                  Crea tutte le 13 collection del progetto in un solo click.
                </p>
              </div>
              <button
                onClick={handleSetup}
                disabled={setupAlphaChat.isPending}
                className="alpha-gradient px-6 py-2.5 rounded-lg text-white font-semibold hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shrink-0"
              >
                {setupAlphaChat.isPending ? (
                  <>
                    <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                    <span>Setup in corso...</span>
                  </>
                ) : (
                  <>
                    <Zap className="w-4 h-4" />
                    <span>Esegui Setup</span>
                  </>
                )}
              </button>
            </div>

            {/* Setup results */}
            {setupResult && (
              <div className="mt-5 space-y-3">
                <div className="flex gap-4 text-sm font-medium">
                  <span className="flex items-center gap-1.5 text-green-400">
                    <CheckCircle2 className="w-4 h-4" />
                    {setupResult.created} create
                  </span>
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <SkipForward className="w-4 h-4" />
                    {setupResult.skipped} già esistenti
                  </span>
                  {setupResult.errors > 0 && (
                    <span className="flex items-center gap-1.5 text-destructive">
                      <AlertCircle className="w-4 h-4" />
                      {setupResult.errors} errori
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                  {setupResult.collections.map((col) => (
                    <div
                      key={col.name}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-mono ${
                        col.status === 'created'
                          ? 'bg-green-500/10 border-green-500/20 text-green-400'
                          : col.status === 'already_exists'
                          ? 'bg-secondary border-border/20 text-muted-foreground'
                          : 'bg-destructive/10 border-destructive/20 text-destructive'
                      }`}
                    >
                      {col.status === 'created' && <CheckCircle2 className="w-3 h-3 shrink-0" />}
                      {col.status === 'already_exists' && <SkipForward className="w-3 h-3 shrink-0" />}
                      {col.status === 'error' && <AlertCircle className="w-3 h-3 shrink-0" />}
                      <span className="truncate">{col.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        {/* ONLY RENDER THESE IF CONNECTED */}
        {isConnected && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start animate-in fade-in slide-in-from-bottom-4 duration-500">
            
            {/* 2. COLLECTIONS LIST (Takes up 2/3 space on large screens) */}
            <section className="bg-card rounded-xl border border-card-border p-6 shadow-lg lg:col-span-2">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-secondary rounded-lg">
                    <LayoutList className="w-5 h-5 text-primary" />
                  </div>
                  <h2 className="text-xl font-semibold">Collezioni</h2>
                </div>
                
                {collectionsData?.collections && (
                  <div className="px-3 py-1 rounded-full bg-secondary text-sm font-medium text-muted-foreground border border-border/20">
                    {collectionsData.collections.length} totali
                  </div>
                )}
              </div>

              {isLoadingCollections ? (
                <div className="space-y-3">
                  {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="h-16 rounded-lg bg-secondary/50 animate-pulse border border-border/10"></div>
                  ))}
                </div>
              ) : isErrorCollections ? (
                <div className="p-6 text-center border border-destructive/20 rounded-lg bg-destructive/5">
                  <p className="text-destructive">Errore nel caricamento delle collezioni.</p>
                  <button onClick={() => refetchCollections()} className="mt-4 text-sm text-muted-foreground hover:text-foreground underline underline-offset-4">Riprova</button>
                </div>
              ) : collectionsData?.collections.length === 0 ? (
                <div className="p-10 text-center border border-dashed border-border/30 rounded-lg bg-secondary/20 flex flex-col items-center">
                  <Layers className="w-10 h-10 text-muted-foreground mb-4 opacity-50" />
                  <p className="text-foreground font-medium text-lg">Nessuna collection trovata.</p>
                  <p className="text-muted-foreground mt-2">Crea la tua prima collezione utilizzando il pannello qui a fianco.</p>
                </div>
              ) : (
                <div className="rounded-lg border border-border/20 overflow-hidden">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-secondary/50 text-muted-foreground border-b border-border/20">
                      <tr>
                        <th className="px-4 py-3 font-medium">Nome</th>
                        <th className="px-4 py-3 font-medium w-24">Tipo</th>
                        <th className="px-4 py-3 font-medium text-right w-32">Documenti</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/10 bg-card">
                      {collectionsData?.collections.map((col) => (
                        <tr key={col.name} className="hover:bg-secondary/30 transition-colors">
                          <td className="px-4 py-3.5 font-mono text-foreground font-medium flex items-center gap-2">
                            <Layers className="w-4 h-4 text-primary/70" />
                            {col.name}
                          </td>
                          <td className="px-4 py-3.5 text-muted-foreground">
                            <span className="px-2 py-0.5 rounded text-xs bg-secondary border border-border/30">
                              {col.type}
                            </span>
                          </td>
                          <td className="px-4 py-3.5 text-right font-mono text-muted-foreground">
                            {col.count !== null && col.count !== undefined ? col.count.toLocaleString() : '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* 3. CREATE COLLECTION */}
            <section className="bg-card rounded-xl border border-card-border p-6 shadow-lg">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 bg-secondary rounded-lg">
                  <Plus className="w-5 h-5 text-primary" />
                </div>
                <h2 className="text-xl font-semibold">Nuova Collezione</h2>
              </div>

              <form onSubmit={handleCreateCollection} className="space-y-5">
                <div>
                  <label htmlFor="colName" className="block text-sm font-medium text-muted-foreground mb-1.5">
                    Nome Collezione
                  </label>
                  <input
                    id="colName"
                    type="text"
                    value={newCollectionName}
                    onChange={(e) => setNewCollectionName(e.target.value)}
                    placeholder="es. users_data"
                    className="w-full bg-input border border-border/30 rounded-lg px-4 py-3 text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-shadow placeholder:text-muted-foreground/50"
                  />
                  
                  {/* Sanitized Preview */}
                  <div className="mt-2 h-5 flex items-center">
                    {newCollectionName && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                        Anteprima salvataggio: 
                        <code className="text-primary font-mono bg-secondary px-1.5 py-0.5 rounded border border-border/20">
                          {sanitizeCollectionName(newCollectionName)}
                        </code>
                      </span>
                    )}
                  </div>
                </div>

                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={!newCollectionName.trim() || createCollection.isPending}
                    className="w-full alpha-gradient px-4 py-2.5 rounded-lg text-white font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {createCollection.isPending ? (
                      <>
                        <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin"></div>
                        <span>Creazione...</span>
                      </>
                    ) : (
                      <>
                        <Plus className="w-4 h-4" />
                        <span>Crea Collezione</span>
                      </>
                    )}
                  </button>
                  
                  {createCollection.isError && (
                     <div className="mt-3 text-xs text-destructive bg-destructive/10 border border-destructive/20 p-2 rounded">
                       Errore durante la creazione.
                     </div>
                  )}
                  {createCollection.isSuccess && (
                     <div className="mt-3 text-xs text-green-400 bg-green-500/10 border border-green-500/20 p-2 rounded">
                       Collezione creata con successo.
                     </div>
                  )}
                </div>
              </form>
            </section>
          </div>
        )}
        
      </div>
    </div>
  );
}
