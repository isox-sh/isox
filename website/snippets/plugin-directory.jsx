export const PluginDirectory = ({ plugins }) => {
  const [query, setQuery] = useState('')
  const [maintainer, setMaintainer] = useState('all')
  const [category, setCategory] = useState('all')
  const categories = [...new Set(plugins.map(plugin => plugin.category))].sort()
  const search = query.trim().toLowerCase()
  const visible = plugins.filter(plugin =>
    (maintainer === 'all' || (maintainer === 'official' ? plugin.official : !plugin.official)) &&
    (category === 'all' || plugin.category === category) &&
    `${plugin.name} ${plugin.description} ${plugin.category}`.toLowerCase().includes(search),
  )

  return (
    <div className="plugin-registry">
      <div className="registry-filters">
        <label className="registry-search">Search plugins
          <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search by name or tool…" />
        </label>
        <label>Maintainer
          <select aria-label="Maintainer" value={maintainer} onChange={event => setMaintainer(event.target.value)}>
            <option value="all">All maintainers</option>
            <option value="official">Official</option>
            <option value="community">Community</option>
          </select>
        </label>
        <label>Category
          <select aria-label="Category" value={category} onChange={event => setCategory(event.target.value)}>
            <option value="all">All categories</option>
            {categories.map(item => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
      </div>
      <p className="registry-count" role="status">Showing {visible.length} of {plugins.length} packages</p>
      <div className="registry-grid">
        {visible.map(plugin => (
          <article className="registry-card" key={plugin.name}>
            <div className="registry-card-meta"><span className={plugin.official ? 'registry-official' : 'registry-community'}>{plugin.official ? 'Official' : 'Community'}</span><span>{plugin.category}</span></div>
            <h2>{plugin.name}</h2>
            <p>{plugin.description}</p>
            <div className="registry-card-links">
              {plugin.docs && <a href={plugin.docs}>Documentation<span className="sr-only"> for {plugin.name}</span></a>}
              <a href={`https://www.npmjs.com/package/${plugin.name}`}>npm<span className="sr-only"> for {plugin.name}</span></a>
              <a href={plugin.url}>Repository<span className="sr-only"> for {plugin.name}</span></a>
            </div>
          </article>
        ))}
      </div>
      {visible.length === 0 && (
        <div className="registry-empty">
          <h2>{maintainer === 'community' && !plugins.some(plugin => !plugin.official) ? 'Be the first community plugin' : 'No matching plugins'}</h2>
          <p>Try another search or <a href="/docs/submit-plugin">submit your plugin</a> to the registry.</p>
          <button type="button" onClick={() => { setQuery(''); setMaintainer('all'); setCategory('all') }}>Clear filters</button>
        </div>
      )}
    </div>
  )
}
