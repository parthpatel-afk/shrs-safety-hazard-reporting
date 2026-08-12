import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ShieldAlert, Clock, Wrench, CheckCircle2, AlertCircle,
  LogOut, Trash2, X, BarChart2, List, Search, SlidersHorizontal,
  ChevronDown, MapPin, User, FileText, ZoomIn,
  Download, Table2, Calendar, Users,
} from 'lucide-react'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Cell, PieChart, Pie, Legend, AreaChart, Area,
} from 'recharts'
import { getSession, saveSession, clearSession } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import { useCompany } from '../hooks/useCompany'
import styles from './Dashboard.module.css'

// ── Constants ──────────────────────────────────────────────
const STATUS_META = {
  'Open':        { label: 'Open',        color: 'var(--status-open)',        Icon: AlertCircle },
  'In Progress': { label: 'In Progress', color: 'var(--status-inprogress)',  Icon: Wrench },
  'Resolved':    { label: 'Resolved',    color: 'var(--status-resolved)',     Icon: CheckCircle2 },
}
const NEXT_ACTIONS = {
  'Open':        ['In Progress', 'Resolved'],
  'In Progress': ['Resolved', 'Open'],
  'Resolved':    ['Open'],
}
const SAFETY_TEAM = [
  'Marcus Johnson',
  'Elena Rodriguez',
  'David Chen',
  'Sarah Jenkins',
  'Mike Torres',
]
const SEVERITY_META = {
  Low:      { color: 'var(--severity-low)',      bg: 'rgba(27,110,60,0.1)' },
  Medium:   { color: 'var(--severity-medium)',   bg: 'rgba(200,139,0,0.1)' },
  High:     { color: 'var(--severity-high)',     bg: 'rgba(192,75,21,0.1)' },
  Critical: { color: 'var(--severity-critical)', bg: 'rgba(185,28,28,0.1)' },
}
const SEVERITY_ORDER = ['Critical', 'High', 'Medium', 'Low']
const CHART_COLORS = ['#C04B15', '#2563EB', '#1B6E3C', '#C88B00', '#6EDFA0', '#7C3AED', '#0891B2', '#EA580C']
const tooltipStyle = {
  contentStyle: { background: '#fff', border: '1px solid rgba(15,31,61,0.12)', borderRadius: 8, fontSize: 13 },
  labelStyle: { color: '#0F1F3D', fontWeight: 700 },
}

// ── Helpers ────────────────────────────────────────────────
function timeAgo(iso) {
  const diff = Math.floor((Date.now() - new Date(iso)) / 1000)
  if (diff < 60)    return `${diff}s ago`
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}
function locationStr(r) {
  return [r.plant, r.department, r.zone, r.area]
    .filter(v => v && v !== 'N/A').join(' › ') || '—'
}

// ── Chart data builders ────────────────────────────────────
function buildChartData(reports, trendMode = 'daily') {
  // By type
  const typeMap = {}
  reports.forEach(r => { typeMap[r.hazard_type] = (typeMap[r.hazard_type] || 0) + 1 })
  const byType = Object.entries(typeMap)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }))

  // By severity
  const sevMap = { Low: 0, Medium: 0, High: 0, Critical: 0 }
  reports.forEach(r => { if (sevMap[r.severity] !== undefined) sevMap[r.severity]++ })
  const bySeverity = SEVERITY_ORDER.map(s => ({ name: s, count: sevMap[s] }))

  // By area (plant + dept, top 8)
  const areaMap = {}
  reports.forEach(r => {
    const parts = [r.plant, r.department].filter(v => v && v !== 'N/A')
    const key = parts.join(' › ') || 'Unknown'
    areaMap[key] = (areaMap[key] || 0) + 1
  })
  const byArea = Object.entries(areaMap)
    .sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([name, count]) => ({ name, count }))

  // Trend — daily (14) / weekly (6) / monthly (6)
  let trend
  if (trendMode === 'weekly') {
    trend = Array.from({ length: 6 }, (_, i) => {
      const end = new Date(); end.setDate(end.getDate() - i * 7)
      const start = new Date(end); start.setDate(start.getDate() - 6)
      const et = end.getTime(), st = start.getTime()
      return {
        date:  start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        count: reports.filter(r => { const t = new Date(r.created_at).getTime(); return t >= st && t <= et }).length,
      }
    }).reverse()
  } else if (trendMode === 'monthly') {
    trend = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i)
      const yr = d.getFullYear(), mo = d.getMonth()
      return {
        date:  d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
        count: reports.filter(r => { const rd = new Date(r.created_at); return rd.getFullYear() === yr && rd.getMonth() === mo }).length,
      }
    }).reverse()
  } else {
    const dayMap = {}
    reports.forEach(r => { const d = r.created_at.split('T')[0]; dayMap[d] = (dayMap[d] || 0) + 1 })
    trend = Array.from({ length: 14 }, (_, i) => {
      const d = new Date(); d.setDate(d.getDate() - (13 - i))
      const key = d.toISOString().split('T')[0]
      return { date: key.slice(5).replace('-', '/'), count: dayMap[key] || 0 }
    })
  }

  return { byType, bySeverity, byArea, trend }
}

// ── Export helpers ─────────────────────────────────────────
const DATE_RANGE_LABELS = {
  all:   'All Time',
  today: 'Today',
  '7d':  'Last 7 Days',
  '30d': 'Last 30 Days',
}

function exportCSV(rows) {
  const headers = ['Date', 'Hazard Type', 'Severity', 'Status', 'Location', 'Reporter', 'Description', 'Notes']
  const data = rows.map(r => [
    `"${new Date(r.created_at).toLocaleString()}"`,
    `"${r.hazard_type}"`,
    r.severity,
    r.status,
    `"${[r.plant, r.department, r.zone, r.area].filter(v => v && v !== 'N/A').join(' › ') || '—'}"`,
    `"${r.reporter_name || 'Anonymous'}"`,
    `"${(r.description || '').replace(/"/g, '""')}"`,
    `"${(r.notes || '').replace(/"/g, '""')}"`,
  ].join(','))
  const csv  = [headers.join(','), ...data].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url
  a.download = `hazard-reports-${new Date().toISOString().split('T')[0]}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function exportPDF({ filtered, company, filters }) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const W   = doc.internal.pageSize.getWidth()

  const BRAND = {
    NAVY:   [15, 31, 61],
    GREEN:  [27, 110, 60],
    ORANGE: [192, 75, 21],
    AMBER:  [200, 139, 0],
    RED:    [185, 28, 28],
    MUTED:  [107, 114, 128],
    BORDER: [229, 231, 235],
    WHITE:  [255, 255, 255],
  }
  const SEV_COLORS = { Low: BRAND.GREEN, Medium: BRAND.AMBER, High: BRAND.ORANGE, Critical: BRAND.RED }
  const STATUS_COLORS = { 'Open': BRAND.ORANGE, 'In Progress': BRAND.AMBER, 'Resolved': BRAND.GREEN }

  const now     = new Date()
  const dateStr = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })

  // ── Header ──
  doc.setFillColor(...BRAND.NAVY)
  doc.rect(0, 0, W, 4, 'F')
  doc.setTextColor(...BRAND.NAVY)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(22)
  doc.text('SAFETY HAZARD REPORT', 14, 20)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.text(company?.name?.toUpperCase() ?? '', 14, 27)
  doc.setTextColor(...BRAND.GREEN)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.text('SAFETY OPERATIONS · AUTHORIZE AUTORISE', 14, 33)
  doc.setTextColor(...BRAND.MUTED)
  doc.setFont('helvetica', 'normal')
  doc.text(`Doc ID: SHRS-${now.getTime().toString().slice(-6)} · Generated ${dateStr} at ${timeStr}`, 14, 38)

  // ── Active filters line ──
  const fp = []
  if (filters.dateRange !== 'all') fp.push(`Period: ${DATE_RANGE_LABELS[filters.dateRange]}`)
  if (filters.status   !== 'all') fp.push(`Status: ${filters.status}`)
  if (filters.severity !== 'all') fp.push(`Severity: ${filters.severity}`)
  if (filters.search)             fp.push(`Search: "${filters.search}"`)
  doc.setFontSize(8)
  doc.text(`Filters: ${fp.length ? fp.join(' · ') : 'All Reports'} · ${filtered.length} report${filtered.length !== 1 ? 's' : ''}`, 14, 44)

  // ── Stat pills ──
  const open       = filtered.filter(r => r.status === 'Open').length
  const inProgress = filtered.filter(r => r.status === 'In Progress').length
  const resolved   = filtered.filter(r => r.status === 'Resolved').length
  const critical   = filtered.filter(r => r.severity === 'Critical' && r.status !== 'Resolved').length
  const statY      = 50
  const statW      = (W - 28 - 9) / 4
  const stats      = [
    { label: 'Open',        value: open,       color: BRAND.ORANGE },
    { label: 'In Progress', value: inProgress, color: BRAND.AMBER  },
    { label: 'Resolved',    value: resolved,   color: BRAND.GREEN  },
    { label: 'Critical',    value: critical,   color: BRAND.RED    },
  ]
  stats.forEach((s, i) => {
    const x = 14 + i * (statW + 3)
    doc.setFillColor(...s.color)
    doc.roundedRect(x, statY, statW, 16, 2, 2, 'F')
    doc.setTextColor(...BRAND.WHITE)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(14)
    doc.text(String(s.value), x + statW / 2, statY + 9, { align: 'center' })
    doc.setFontSize(7)
    doc.setFont('helvetica', 'normal')
    doc.text(s.label.toUpperCase(), x + statW / 2, statY + 13.5, { align: 'center' })
  })

  // ── Table ──
  autoTable(doc, {
    startY: statY + 22,
    head: [['Date', 'Hazard Type', 'Severity', 'Status', 'Location', 'Reporter', 'Description']],
    body: filtered.map(r => [
      new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }),
      r.hazard_type,
      r.severity,
      r.status,
      [r.plant, r.department, r.zone, r.area].filter(v => v && v !== 'N/A').join(' › ') || '—',
      r.reporter_name || 'Anonymous',
      r.description ? r.description.slice(0, 80) + (r.description.length > 80 ? '…' : '') : '—',
    ]),
    theme: 'grid',
    styles:     { fontSize: 8, cellPadding: 3, font: 'helvetica', textColor: BRAND.NAVY, lineColor: BRAND.BORDER },
    headStyles: { fillColor: BRAND.NAVY, textColor: BRAND.WHITE, fontStyle: 'bold', fontSize: 7.5 },
    columnStyles: { 0: { cellWidth: 16 }, 1: { cellWidth: 26 }, 2: { cellWidth: 16 }, 3: { cellWidth: 20 }, 4: { cellWidth: 34 }, 5: { cellWidth: 20 }, 6: { cellWidth: 'auto' } },
    didParseCell: (data) => {
      if (data.section !== 'body') return
      if (data.column.index === 2) {
        const col = SEV_COLORS[data.cell.raw]
        if (col) { data.cell.styles.textColor = col; data.cell.styles.fontStyle = 'bold' }
      }
      if (data.column.index === 3) {
        const col = STATUS_COLORS[data.cell.raw]
        if (col) { data.cell.styles.textColor = col; data.cell.styles.fontStyle = 'bold' }
      }
    },
    margin: { left: 14, right: 14 },
  })

  // ── Analytics Summary (new page) ──
  if (filtered.length > 0) {
    doc.addPage()
    doc.setFillColor(...BRAND.NAVY)
    doc.rect(0, 0, W, 4, 'F')
    doc.setTextColor(...BRAND.NAVY)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(16)
    doc.text('ANALYTICS SUMMARY', 14, 18)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...BRAND.MUTED)
    doc.text(`Based on ${filtered.length} report${filtered.length !== 1 ? 's' : ''} · ${fp.length ? fp.join(' · ') : 'All Reports'}`, 14, 24)

    // Hazards by Type
    const typeMap = {}
    filtered.forEach(r => { typeMap[r.hazard_type] = (typeMap[r.hazard_type] || 0) + 1 })
    const byType = Object.entries(typeMap).sort((a, b) => b[1] - a[1])

    autoTable(doc, {
      startY: 30,
      head: [['Hazard Type', 'Count', 'Share']],
      body: byType.map(([name, count]) => [
        name,
        count,
        `${Math.round((count / filtered.length) * 100)}%`,
      ]),
      theme: 'striped',
      styles:     { fontSize: 8, cellPadding: 3, font: 'helvetica', textColor: BRAND.NAVY },
      headStyles: { fillColor: BRAND.NAVY, textColor: BRAND.WHITE, fontStyle: 'bold', fontSize: 7.5 },
      columnStyles: { 1: { cellWidth: 20, halign: 'center' }, 2: { cellWidth: 20, halign: 'center' } },
      margin: { left: 14, right: W / 2 + 2 },
      tableWidth: W / 2 - 16,
      didDrawPage: () => {},
    })

    // Hazards by Severity (alongside type table)
    const sevMap = { Critical: 0, High: 0, Medium: 0, Low: 0 }
    filtered.forEach(r => { if (sevMap[r.severity] !== undefined) sevMap[r.severity]++ })

    autoTable(doc, {
      startY: 30,
      head: [['Severity', 'Count', 'Share']],
      body: Object.entries(sevMap).map(([name, count]) => [
        name,
        count,
        `${filtered.length > 0 ? Math.round((count / filtered.length) * 100) : 0}%`,
      ]),
      theme: 'striped',
      styles:     { fontSize: 8, cellPadding: 3, font: 'helvetica', textColor: BRAND.NAVY },
      headStyles: { fillColor: BRAND.NAVY, textColor: BRAND.WHITE, fontStyle: 'bold', fontSize: 7.5 },
      columnStyles: { 0: { cellWidth: 30 }, 1: { cellWidth: 20, halign: 'center' }, 2: { cellWidth: 20, halign: 'center' } },
      didParseCell: (data) => {
        if (data.section === 'body' && data.column.index === 0) {
          const col = SEV_COLORS[data.cell.raw]
          if (col) { data.cell.styles.textColor = col; data.cell.styles.fontStyle = 'bold' }
        }
      },
      margin: { left: W / 2 + 2, right: 14 },
      tableWidth: W / 2 - 16,
    })

    // Hazards by Status
    const statusMap = { Open: 0, 'In Progress': 0, Resolved: 0 }
    filtered.forEach(r => { if (statusMap[r.status] !== undefined) statusMap[r.status]++ })
    const afterY = (doc.lastAutoTable?.finalY ?? 30) + 10

    autoTable(doc, {
      startY: afterY,
      head: [['Status', 'Count', 'Share']],
      body: Object.entries(statusMap).map(([name, count]) => [
        name,
        count,
        `${filtered.length > 0 ? Math.round((count / filtered.length) * 100) : 0}%`,
      ]),
      theme: 'striped',
      styles:     { fontSize: 8, cellPadding: 3, font: 'helvetica', textColor: BRAND.NAVY },
      headStyles: { fillColor: BRAND.NAVY, textColor: BRAND.WHITE, fontStyle: 'bold', fontSize: 7.5 },
      columnStyles: { 0: { cellWidth: 35 }, 1: { cellWidth: 20, halign: 'center' }, 2: { cellWidth: 20, halign: 'center' } },
      didParseCell: (data) => {
        if (data.section === 'body' && data.column.index === 0) {
          const col = STATUS_COLORS[data.cell.raw]
          if (col) { data.cell.styles.textColor = col; data.cell.styles.fontStyle = 'bold' }
        }
      },
      margin: { left: 14, right: W / 2 + 2 },
      tableWidth: W / 2 - 16,
    })
  }

  // ── Footer on every page ──
  const pageCount = doc.internal.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    const pH = doc.internal.pageSize.getHeight()
    doc.setFillColor(...BRAND.NAVY)
    doc.rect(0, pH - 10, W, 10, 'F')
    doc.setTextColor(...BRAND.WHITE)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.text('AUTHORIZE AUTORISE · autoriseconsulting.com', 14, pH - 3.5)
    doc.text(`Page ${i} of ${pageCount}`, W - 14, pH - 3.5, { align: 'right' })
  }

  doc.save(`hazard-report-${now.toISOString().split('T')[0]}.pdf`)
}

// ── Login Form ─────────────────────────────────────────────
function LoginForm({ companySlug, company, onLogin }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)
  const navigate = useNavigate()

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { data, error: err } = await supabase
      .from('managers')
      .select('*')
      .eq('company_id', company.id)
      .eq('username', username.trim().toLowerCase())
      .eq('password', password)
      .maybeSingle()
    setLoading(false)
    if (err || !data) { setError('Invalid username or password.'); return }
    saveSession(companySlug, data)
    onLogin(data)
  }

  return (
    <div className={styles.loginPage}>
      <button className={styles.homeBtn} onClick={() => navigate(`/${companySlug}`)}>← Home</button>
      <div className={styles.loginCard}>
        {company?.logo_url && (
          <img src={company.logo_url} alt={company.name} className={styles.loginLogo} />
        )}
        <p className={styles.loginBrand}>{company?.name}</p>
        <h1 className={styles.loginTitle}>Safety Dashboard</h1>
        <p className={styles.loginSub}>Safety team access only</p>
        <form className={styles.loginForm} onSubmit={handleSubmit}>
          <input className={styles.loginInput} type="text" placeholder="Username"
            value={username} onChange={e => setUsername(e.target.value)} required autoFocus />
          <input className={styles.loginInput} type="password" placeholder="Password"
            value={password} onChange={e => setPassword(e.target.value)} required />
          {error && <p className={styles.loginError}>{error}</p>}
          <button className={styles.loginBtn} type="submit" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign In →'}
          </button>
        </form>
        <p className={styles.loginRegisterHint}>
          Need an account?{' '}
          <button className={styles.loginRegisterLink} onClick={() => navigate(`/register/${companySlug}`)}>
            Register
          </button>
        </p>
      </div>
    </div>
  )
}

// ── Lightbox ───────────────────────────────────────────────
function Lightbox({ url, onClose }) {
  return (
    <div className={styles.lightboxOverlay} onClick={onClose}>
      <button className={styles.lightboxClose} onClick={onClose}><X size={24} /></button>
      <img
        src={url}
        alt="Hazard photo"
        className={styles.lightboxImg}
        onClick={e => e.stopPropagation()}
      />
    </div>
  )
}

// ── Filter Select (custom dropdown) ───────────────────────
function FilterSelect({ icon: Icon, value, onChange, options }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  const selected = options.find(o => o.value === value)

  return (
    <div className={styles.customSelect} ref={ref}>
      <button
        type="button"
        className={`${styles.customSelectTrigger} ${open ? styles.customSelectOpen : ''}`}
        onClick={() => setOpen(o => !o)}
      >
        {Icon && <Icon size={13} />}
        <span>{selected?.label}</span>
        <ChevronDown size={13} className={`${styles.selectChev} ${open ? styles.selectChevOpen : ''}`} />
      </button>
      {open && (
        <div className={styles.customSelectMenu}>
          {options.map(o => (
            <button
              key={o.value}
              type="button"
              className={`${styles.customSelectItem} ${o.value === value ? styles.customSelectItemActive : ''}`}
              onClick={() => { onChange(o.value); setOpen(false) }}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main Dashboard ─────────────────────────────────────────
export default function Dashboard() {
  const { companySlug } = useParams()
  const navigate = useNavigate()
  const { company, loading: companyLoading } = useCompany(companySlug)

  const [session, setSession]       = useState(() => getSession(companySlug))
  const [reports, setReports]       = useState([])
  const [loading, setLoading]       = useState(false)
  const [tab, setTab]               = useState('list')   // 'list' | 'charts'
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterSeverity, setFilterSeverity] = useState('all')
  const [filterSearch, setFilterSearch]     = useState('')
  const [expandedId, setExpandedId] = useState(null)
  const [lightboxUrl, setLightboxUrl] = useState(null)
  const [notesMap, setNotesMap]     = useState({})
  const [savingNotes, setSavingNotes] = useState({})
  const [deletingId, setDeletingId] = useState(null)

  // ── Area / Date / Export controls ────────────────────────
  const [areaMine, setAreaMine]       = useState(false)
  const [dateRange, setDateRange]     = useState('all')
  const [exportOpen, setExportOpen]   = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const exportRef                     = useRef(null)

  // ── Analytics controls ────────────────────────────────────
  const [trendMode, setTrendMode]         = useState('daily')  // 'daily'|'weekly'|'monthly'
  const [chartTypeFilter, setChartTypeFilter] = useState('all')
  const [chartAreaFilter, setChartAreaFilter] = useState('all')

  // ── Location filters ──────────────────────────────────────
  const [filterPlant, setFilterPlant] = useState('all')
  const [filterDept, setFilterDept]   = useState('all')

  // ── Load reports ──────────────────────────────────────────
  const loadReports = useCallback(async () => {
    if (!company) return
    setLoading(true)
    const { data } = await supabase
      .from('hazard_reports')
      .select('*')
      .eq('company_id', company.id)
      .order('created_at', { ascending: false })
    setReports(data || [])
    setLoading(false)
  }, [company])

  useEffect(() => { if (company && session) loadReports() }, [company, session, loadReports])

  // ── Realtime subscription ─────────────────────────────────
  useEffect(() => {
    if (!company || !session) return
    const channel = supabase
      .channel(`shrs_hazards_${company.id}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'hazard_reports',
        filter: `company_id=eq.${company.id}`,
      }, () => loadReports())
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [company, session, loadReports])

  // ── Close export dropdown on outside click ───────────────
  useEffect(() => {
    function handler(e) {
      if (exportRef.current && !exportRef.current.contains(e.target)) setExportOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // ── Actions ───────────────────────────────────────────────
  const [assigningId, setAssigningId] = useState(null)
  const [assignedSuccessId, setAssignedSuccessId] = useState(null)

  async function updateStatus(id, newStatus) {
    const patch = { status: newStatus }
    if (newStatus === 'Resolved') patch.resolved_at = new Date().toISOString()
    else patch.resolved_at = null
    await supabase.from('hazard_reports').update(patch).eq('id', id)
    setReports(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r))
  }

  async function saveNotes(id) {
    setSavingNotes(prev => ({ ...prev, [id]: true }))
    const notes = notesMap[id] ?? reports.find(r => r.id === id)?.notes ?? ''
    await supabase.from('hazard_reports').update({ notes }).eq('id', id)
    setReports(prev => prev.map(r => r.id === id ? { ...r, notes } : r))
    setSavingNotes(prev => ({ ...prev, [id]: false }))
  }

  async function assignToUser(id, user) {
    setAssigningId(id)
    await supabase.from('hazard_reports').update({ assigned_to: user }).eq('id', id)
    setReports(prev => prev.map(r => r.id === id ? { ...r, assigned_to: user } : r))
    setAssigningId(null)
    setAssignedSuccessId(id)
    setTimeout(() => setAssignedSuccessId(null), 3000)
  }

  async function deleteReport(id, photoUrl) {
    if (!window.confirm('Delete this hazard report? This cannot be undone.')) return
    setDeletingId(id)
    // Delete photo from storage if it exists
    if (photoUrl) {
      const path = photoUrl.split('/hazard-photos/')[1]
      if (path) await supabase.storage.from('hazard-photos').remove([path])
    }
    await supabase.from('hazard_reports').delete().eq('id', id)
    setReports(prev => prev.filter(r => r.id !== id))
    setDeletingId(null)
  }

  function handleLogout() {
    clearSession(companySlug)
    setSession(null)
  }

  // ── Auth gate ─────────────────────────────────────────────
  if (companyLoading) return <div className={styles.page} />
  if (!session) return <LoginForm companySlug={companySlug} company={company} onLogin={setSession} />

  // ── My Area logic ─────────────────────────────────────────
  const hasArea = session && (session.plant || session.department || session.zone || session.line)

  function isMyArea(r) {
    if (!hasArea) return false
    return (
      (!session.plant      || r.plant      === session.plant)      &&
      (!session.department || r.department === session.department) &&
      (!session.zone       || r.zone       === session.zone)       &&
      (!session.line       || r.area       === session.line)
    )
  }

  // ── Date + Area filtering ─────────────────────────────────
  const areaBase = areaMine ? reports.filter(isMyArea) : reports

  const dateFiltered = (() => {
    if (dateRange === 'all') return areaBase
    if (dateRange === 'today') {
      const start = new Date(); start.setHours(0, 0, 0, 0)
      return areaBase.filter(r => new Date(r.created_at) >= start)
    }
    const ms = dateRange === '7d' ? 7 * 86400000 : 30 * 86400000
    const cutoff = Date.now() - ms
    return areaBase.filter(r => new Date(r.created_at).getTime() >= cutoff)
  })()

  // Unique location values for filters
  const allPlants = [...new Set(reports.map(r => r.plant).filter(v => v && v !== 'N/A'))].sort()
  const allDepts  = [...new Set(reports.map(r => r.department).filter(v => v && v !== 'N/A'))].sort()

  // ── Filter ────────────────────────────────────────────────
  const filtered = dateFiltered.filter(r => {
    if (filterStatus   !== 'all' && r.status   !== filterStatus)   return false
    if (filterSeverity !== 'all' && r.severity !== filterSeverity) return false
    if (filterPlant    !== 'all' && r.plant     !== filterPlant)    return false
    if (filterDept     !== 'all' && r.department !== filterDept)    return false
    if (filterSearch) {
      const q = filterSearch.toLowerCase()
      if (![r.hazard_type, r.description, r.reporter_name, locationStr(r)]
        .some(v => v?.toLowerCase().includes(q))) return false
    }
    return true
  })

  // ── Export handlers ───────────────────────────────────────
  function handleExportCSV() { setExportOpen(false); exportCSV(filtered) }
  function handleExportPDF() {
    setExportOpen(false)
    exportPDF({ filtered, company, filters: { dateRange, status: filterStatus, severity: filterSeverity, search: filterSearch } })
  }

  // ── Stat counts (always all-time current state) ───────────
  const openCount       = reports.filter(r => r.status === 'Open').length
  const inProgressCount = reports.filter(r => r.status === 'In Progress').length
  const resolvedCount   = reports.filter(r => r.status === 'Resolved').length
  const criticalCount   = reports.filter(r => r.severity === 'Critical' && r.status !== 'Resolved').length

  // Chart data — can be further filtered by type/area within analytics tab
  const chartFiltered = filtered.filter(r => {
    if (chartTypeFilter !== 'all' && r.hazard_type !== chartTypeFilter) return false
    if (chartAreaFilter !== 'all') {
      const area = [r.plant, r.department].filter(v => v && v !== 'N/A').join(' › ') || 'Unknown'
      if (area !== chartAreaFilter) return false
    }
    return true
  })
  const charts = buildChartData(chartFiltered, trendMode)

  // Unique values for analytics filters
  const allHazardTypes = [...new Set(filtered.map(r => r.hazard_type).filter(Boolean))].sort()
  const allChartAreas  = [...new Set(filtered.map(r => {
    const parts = [r.plant, r.department].filter(v => v && v !== 'N/A')
    return parts.join(' › ') || 'Unknown'
  }))].sort()

  const activeFilterCount =
    (filterStatus !== 'all' ? 1 : 0) +
    (filterSeverity !== 'all' ? 1 : 0) +
    (filterSearch.trim() ? 1 : 0) +
    (dateRange !== 'all' ? 1 : 0) +
    (areaMine ? 1 : 0) +
    (filterPlant !== 'all' ? 1 : 0) +
    (filterDept !== 'all' ? 1 : 0)

  return (
    <div className={styles.page}>
      {lightboxUrl && <Lightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />}

      {/* ── Top Bar ── */}
      <header className={styles.topBar}>
        <div className={styles.topBarLeft}>
          <button className={styles.topBarBrand} onClick={() => navigate(`/${companySlug}`)} title="Home">
            {company?.logo_url && (
              <img src={company.logo_url} alt={company.name} className={styles.topBarLogo} />
            )}
            <div>
              <p className={styles.topBarCompany}>{company?.name}</p>
              <p className={styles.topBarTitle}>Safety Dashboard</p>
            </div>
          </button>
        </div>
        <div className={styles.topBarRight}>
          <span className={styles.topBarUser}>{session.name}</span>
          <button className={styles.logoutBtn} onClick={handleLogout} title="Sign out">
            <LogOut size={16} />
          </button>
        </div>
      </header>

      {/* ── Tab Navigation ── */}
      <nav className={styles.tabs}>
        <button className={`${styles.tab} ${tab === 'list' ? styles.tabActive : ''}`} onClick={() => setTab('list')}>
          <List size={15} /> Reports
        </button>
        <button className={`${styles.tab} ${tab === 'charts' ? styles.tabActive : ''}`} onClick={() => setTab('charts')}>
          <BarChart2 size={15} /> Analytics
        </button>

        {/* Area toggle + desktop inline filters */}
        <div className={styles.areaFilters}>
          {hasArea && (
            <button
              className={`${styles.areaFilterBtn} ${!areaMine ? styles.areaFilterActive : ''}`}
              onClick={() => setAreaMine(false)}
            >
              All Areas
            </button>
          )}
          {hasArea && (
            <button
              className={`${styles.areaFilterBtn} ${areaMine ? styles.areaFilterMineActive : ''}`}
              onClick={() => setAreaMine(true)}
            >
              My Area
            </button>
          )}
          <div className={styles.navInlineFilters}>
            <select className={styles.navSelect} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
              <option value="all">All Statuses</option>
              {Object.keys(STATUS_META).map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select className={styles.navSelect} value={filterSeverity} onChange={e => setFilterSeverity(e.target.value)}>
              <option value="all">All Severities</option>
              {SEVERITY_ORDER.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select className={styles.navSelect} value={dateRange} onChange={e => setDateRange(e.target.value)}>
              <option value="all">All Time</option>
              <option value="today">Today</option>
              <option value="7d">Last 7 Days</option>
              <option value="30d">Last 30 Days</option>
            </select>
            {allPlants.length > 0 && (
              <select className={styles.navSelect} value={filterPlant} onChange={e => setFilterPlant(e.target.value)}>
                <option value="all">All Plants</option>
                {allPlants.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            )}
            {allDepts.length > 0 && (
              <select className={styles.navSelect} value={filterDept} onChange={e => setFilterDept(e.target.value)}>
                <option value="all">All Depts</option>
                {allDepts.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            )}
          </div>
          {/* Export — desktop: after filters; mobile: right side of area row */}
          <div ref={exportRef} className={styles.exportWrap} style={{ marginLeft: 'auto' }}>
            <button
              className={`${styles.exportBtn} ${exportOpen ? styles.exportBtnActive : ''}`}
              onClick={() => setExportOpen(v => !v)}
            >
              <Download size={13} />
              <span>Export</span>
              <ChevronDown size={11} />
            </button>
            {exportOpen && (
              <div className={styles.exportDropdown}>
                <button className={styles.exportDropdownItem} onClick={handleExportPDF}>
                  <FileText size={13} />
                  <span><strong>Report</strong> <em>.pdf</em></span>
                </button>
                <button className={styles.exportDropdownItem} onClick={handleExportCSV}>
                  <Table2 size={13} />
                  <span><strong>Raw</strong> <em>.csv</em></span>
                </button>
              </div>
            )}
          </div>
        </div>
      </nav>

      {/* Stat pills — full-width bar between tab nav and content */}
      <div className={styles.mobileStatPills}>
        <span className={styles.mobileStatPill} style={{ '--s': 'var(--status-open)' }}>{openCount} Open</span>
        <span className={styles.mobileStatPill} style={{ '--s': 'var(--status-inprogress)' }}>{inProgressCount} In Progress</span>
        <span className={styles.mobileStatPill} style={{ '--s': 'var(--status-resolved)' }}>{resolvedCount} Resolved</span>
        <span className={styles.mobileStatPill} style={{ '--s': 'var(--severity-critical)' }}>{criticalCount} Critical Open</span>
      </div>

      <div className={styles.content}>

        {/* ── LIST TAB ── */}
        {tab === 'list' && (
          <>
            {/* Count */}
            <p className={styles.resultCount}>
              {filtered.length} report{filtered.length !== 1 ? 's' : ''}{activeFilterCount > 0 ? ' (filtered)' : ''}
            </p>

            {/* Report Cards */}
            {loading && <p className={styles.emptyMsg}>Loading…</p>}
            {!loading && filtered.length === 0 && (
              <div className={styles.emptyState}>
                <CheckCircle2 size={36} color="var(--status-resolved)" />
                <p>No reports match your filters.</p>
              </div>
            )}

            <div className={styles.reportList}>
              {filtered.map(report => {
                const sevMeta  = SEVERITY_META[report.severity] || SEVERITY_META.Medium
                const statMeta = STATUS_META[report.status] || STATUS_META['Open']
                const isExpanded = expandedId === report.id
                const currentNotes = notesMap[report.id] ?? report.notes ?? ''

                return (
                  <div
                    key={report.id}
                    className={`${styles.reportCard} ${report.severity === 'Critical' ? styles.reportCritical : ''}`}
                  >
                    {/* ── Card Header ── */}
                    <div className={styles.cardHeader} onClick={() => setExpandedId(isExpanded ? null : report.id)}>
                      <div className={styles.cardHeaderLeft}>
                        {report.photo_url ? (
                          <div
                            className={styles.photoThumb}
                            onClick={e => { e.stopPropagation(); setLightboxUrl(report.photo_url) }}
                            title="Click to view photo"
                          >
                            <img src={report.photo_url} alt="Hazard" />
                            <div className={styles.photoThumbOverlay}><ZoomIn size={14} /></div>
                          </div>
                        ) : (
                          <div className={styles.photoPlaceholder}><ShieldAlert size={20} color="var(--text-muted)" /></div>
                        )}
                        <div className={styles.cardMeta}>
                          <p className={styles.hazardType}>{report.hazard_type}</p>
                          <p className={styles.cardLocation}><MapPin size={11} />{locationStr(report)}</p>
                          <p className={styles.cardTime}>{timeAgo(report.created_at)}{report.reporter_name && report.reporter_name !== 'Anonymous' && ` · ${report.reporter_name}`}</p>
                        </div>
                      </div>
                      <div className={styles.cardHeaderRight}>
                        <span
                          className={styles.severityBadge}
                          style={{ color: sevMeta.color, background: sevMeta.bg }}
                        >
                          {report.severity}
                        </span>
                        <span
                          className={styles.statusBadge}
                          style={{ color: statMeta.color }}
                        >
                          <statMeta.Icon size={12} />{report.status}
                        </span>
                        <ChevronDown size={16} className={`${styles.expandChev} ${isExpanded ? styles.expandChevOpen : ''}`} />
                      </div>
                    </div>

                    {/* ── Expanded Detail ── */}
                    {isExpanded && (
                      <div className={styles.cardDetail}>
                        {report.description && (
                          <div className={styles.detailSection}>
                            <p className={styles.detailLabel}><FileText size={13} /> Description</p>
                            <p className={styles.detailText}>{report.description}</p>
                          </div>
                        )}
                        {report.reporter_name && report.reporter_name !== 'Anonymous' && (
                          <div className={styles.detailSection}>
                            <p className={styles.detailLabel}><User size={13} /> Reporter</p>
                            <p className={styles.detailText}>{report.reporter_name}</p>
                          </div>
                        )}

                        {/* Assignment */}
                        <div className={styles.detailSection}>
                          <p className={styles.detailLabel}>Assign To</p>
                          <div className={styles.assignRow}>
                            <select
                              className={styles.assignSelect}
                              value={report.assigned_to || ''}
                              onChange={e => assignToUser(report.id, e.target.value)}
                              disabled={assigningId === report.id}
                            >
                              <option value="">Unassigned</option>
                              {SAFETY_TEAM.map(name => (
                                <option key={name} value={name}>{name}</option>
                              ))}
                            </select>
                            {assigningId === report.id && <span className={styles.assigningText}>Assigning…</span>}
                            {assignedSuccessId === report.id && (
                              <span className={styles.assignedSuccess}>
                                <CheckCircle2 size={13} /> Your safety support has been notified
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Status Actions */}
                        <div className={styles.detailSection}>
                          <p className={styles.detailLabel}>Update Status</p>
                          <div className={styles.actionBtns}>
                            {NEXT_ACTIONS[report.status]?.map(next => {
                              const m = STATUS_META[next]
                              return (
                                <button
                                  key={next}
                                  className={styles.actionBtn}
                                  style={{ borderColor: m.color, color: m.color }}
                                  onClick={() => updateStatus(report.id, next)}
                                >
                                  <m.Icon size={13} /> Mark {next}
                                </button>
                              )
                            })}
                          </div>
                        </div>

                        {/* Notes */}
                        <div className={styles.detailSection}>
                          <p className={styles.detailLabel}>Safety Team Notes</p>
                          <textarea
                            className={styles.notesInput}
                            rows={3}
                            maxLength={1000}
                            placeholder="Add notes, action taken, follow-up required…"
                            value={currentNotes}
                            onChange={e => setNotesMap(prev => ({ ...prev, [report.id]: e.target.value }))}
                          />
                          <div className={styles.notesFooter}>
                            <button
                              className={styles.saveNotesBtn}
                              onClick={() => saveNotes(report.id)}
                              disabled={savingNotes[report.id]}
                            >
                              {savingNotes[report.id] ? 'Saving…' : 'Save Notes'}
                            </button>
                            <span className={styles.notesCount}>{currentNotes.length}/1000</span>
                          </div>
                        </div>

                        {/* Delete */}
                        <button
                          className={styles.deleteBtn}
                          onClick={() => deleteReport(report.id, report.photo_url)}
                          disabled={deletingId === report.id}
                        >
                          <Trash2 size={14} />
                          {deletingId === report.id ? 'Deleting…' : 'Delete Report'}
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </>
        )}

        {/* ── CHARTS TAB ── */}
        {tab === 'charts' && (
          <>
            {/* Analytics-specific filters */}
            <div className={styles.analyticsFilters}>
              <select className={styles.analyticsSelect}
                value={chartTypeFilter} onChange={e => setChartTypeFilter(e.target.value)}>
                <option value="all">All Types</option>
                {allHazardTypes.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <select className={styles.analyticsSelect}
                value={chartAreaFilter} onChange={e => setChartAreaFilter(e.target.value)}>
                <option value="all">All Areas</option>
                {allChartAreas.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
              {(chartTypeFilter !== 'all' || chartAreaFilter !== 'all') && (
                <button className={styles.analyticsClearBtn}
                  onClick={() => { setChartTypeFilter('all'); setChartAreaFilter('all') }}>
                  Clear ×
                </button>
              )}
              <span className={styles.analyticsCount}>
                {chartFiltered.length} report{chartFiltered.length !== 1 ? 's' : ''}
              </span>
            </div>

            <div className={styles.chartsGrid}>

              {/* By Type */}
              <div className={styles.chartCard}>
                <p className={styles.chartTitle}>Hazards by Type</p>
                {charts.byType.length === 0 ? <p className={styles.chartEmpty}>No data yet</p> : (
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={charts.byType} layout="vertical" margin={{ left: 0, right: 12, top: 4, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(15,31,61,0.07)" />
                      <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                      <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 11 }} />
                      <Tooltip {...tooltipStyle} />
                      <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                        {charts.byType.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>

              {/* By Severity */}
              <div className={styles.chartCard}>
                <p className={styles.chartTitle}>Hazards by Severity</p>
                {chartFiltered.length === 0 ? <p className={styles.chartEmpty}>No data yet</p> : (
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie
                        data={charts.bySeverity.filter(d => d.count > 0)}
                        dataKey="count" nameKey="name" cx="50%" cy="50%" outerRadius={80}
                        label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                        labelLine={false}
                      >
                        {charts.bySeverity.map(s => (
                          <Cell key={s.name} fill={(SEVERITY_META[s.name] || {}).color || '#ccc'} />
                        ))}
                      </Pie>
                      <Tooltip {...tooltipStyle} />
                      <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>

              {/* By Area */}
              <div className={styles.chartCard}>
                <p className={styles.chartTitle}>Hazards by Area</p>
                {charts.byArea.length === 0 ? <p className={styles.chartEmpty}>No data yet</p> : (
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={charts.byArea} layout="vertical" margin={{ left: 0, right: 12, top: 4, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(15,31,61,0.07)" />
                      <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                      <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 10 }} />
                      <Tooltip {...tooltipStyle} />
                      <Bar dataKey="count" fill="var(--severity-high)" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>

              {/* Trend */}
              <div className={styles.chartCard}>
                <div className={styles.chartTitleRow}>
                  <p className={styles.chartTitle}>Volume Trend</p>
                  <div className={styles.trendSelector}>
                    {[['daily','Daily'],['weekly','Weekly'],['monthly','Monthly']].map(([v,l]) => (
                      <button key={v}
                        className={`${styles.trendBtn} ${trendMode === v ? styles.trendBtnActive : ''}`}
                        onClick={() => setTrendMode(v)}>{l}</button>
                    ))}
                  </div>
                </div>
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={charts.trend} margin={{ left: -10, right: 12, top: 4, bottom: 4 }}>
                    <defs>
                      <linearGradient id="shrsGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor="var(--severity-high)" stopOpacity={0.25} />
                        <stop offset="95%" stopColor="var(--severity-high)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(15,31,61,0.07)" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                    <Tooltip {...tooltipStyle} />
                    <Area type="monotone" dataKey="count" name="Reports"
                      stroke="var(--severity-high)" fill="url(#shrsGrad)" strokeWidth={2} dot={{ r: 3 }} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

            </div>
          </>
        )}

      </div>

      {/* ── Mobile Filter FAB ── */}
      <button
        className={`${styles.mobileFilterFab} ${activeFilterCount > 0 ? styles.mobileFilterFabActive : ''}`}
        onClick={() => setFiltersOpen(v => !v)}
        aria-label="Open filters"
      >
        <SlidersHorizontal size={15} />
        {activeFilterCount > 0 && (
          <span className={styles.mobileFilterBadge}>{activeFilterCount}</span>
        )}
      </button>

      {/* ── Mobile Backdrop ── */}
      {filtersOpen && (
        <div className={styles.mobileFilterBackdrop} onClick={() => setFiltersOpen(false)} />
      )}

      {/* ── Mobile Bottom Sheet ── */}
      <div className={`${styles.mobileFilterSheet} ${filtersOpen ? styles.mobileFilterSheetOpen : ''}`}>
        <div className={styles.mobileFilterHandle} />
        <div className={styles.mobileFilterSheetHeader}>
          <span className={styles.mobileFilterSheetTitle}>Filters</span>
          <button className={styles.mobileFilterClose} onClick={() => setFiltersOpen(false)}>
            <X size={16} />
          </button>
        </div>

        <div className={styles.mobileFilterSection}>
          <span className={styles.mobileFilterLabel}>Search</span>
          <div className={styles.mobileSearchWrap}>
            <Search size={13} className={styles.searchIcon} />
            <input
              className={styles.mobileSearchInput}
              placeholder="Type, location, description…"
              value={filterSearch}
              onChange={e => setFilterSearch(e.target.value)}
            />
          </div>
        </div>

        <div className={styles.mobileFilterSection}>
          <span className={styles.mobileFilterLabel}>Date Range</span>
          <div className={styles.mobileChipRow}>
            {[
              { value: 'all',   label: 'All Time'     },
              { value: 'today', label: 'Today'        },
              { value: '7d',    label: 'Last 7 Days'  },
              { value: '30d',   label: 'Last 30 Days' },
            ].map(o => (
              <button
                key={o.value}
                className={`${styles.mobileChip} ${dateRange === o.value ? styles.mobileChipActive : ''}`}
                onClick={() => setDateRange(o.value)}
              >{o.label}</button>
            ))}
          </div>
        </div>

        <div className={styles.mobileFilterSection}>
          <span className={styles.mobileFilterLabel}>Status</span>
          <div className={styles.mobileChipRow}>
            {[{ value: 'all', label: 'All' }, ...Object.keys(STATUS_META).map(s => ({ value: s, label: s }))].map(o => (
              <button
                key={o.value}
                className={`${styles.mobileChip} ${filterStatus === o.value ? styles.mobileChipActive : ''}`}
                onClick={() => setFilterStatus(o.value)}
              >{o.label}</button>
            ))}
          </div>
        </div>

        <div className={styles.mobileFilterSection}>
          <span className={styles.mobileFilterLabel}>Severity</span>
          <div className={styles.mobileChipRow}>
            {[{ value: 'all', label: 'All' }, ...SEVERITY_ORDER.map(s => ({ value: s, label: s }))].map(o => (
              <button
                key={o.value}
                className={`${styles.mobileChip} ${filterSeverity === o.value ? styles.mobileChipActive : ''}`}
                onClick={() => setFilterSeverity(o.value)}
              >{o.label}</button>
            ))}
          </div>
        </div>

        {hasArea && (
          <div className={styles.mobileFilterSection}>
            <span className={styles.mobileFilterLabel}>Area</span>
            <div className={styles.mobileChipRow}>
              <button
                className={`${styles.mobileChip} ${!areaMine ? styles.mobileChipActive : ''}`}
                onClick={() => setAreaMine(false)}
              >All Areas</button>
              <button
                className={`${styles.mobileChip} ${areaMine ? styles.mobileChipMineActive : ''}`}
                onClick={() => setAreaMine(true)}
              >My Area</button>
            </div>
          </div>
        )}

        {allPlants.length > 0 && (
          <div className={styles.mobileFilterSection}>
            <span className={styles.mobileFilterLabel}>Plant</span>
            <div className={styles.mobileChipRow}>
              <button className={`${styles.mobileChip} ${filterPlant === 'all' ? styles.mobileChipActive : ''}`} onClick={() => setFilterPlant('all')}>All</button>
              {allPlants.map(p => (
                <button key={p} className={`${styles.mobileChip} ${filterPlant === p ? styles.mobileChipActive : ''}`} onClick={() => setFilterPlant(p)}>{p}</button>
              ))}
            </div>
          </div>
        )}

        {allDepts.length > 0 && (
          <div className={styles.mobileFilterSection}>
            <span className={styles.mobileFilterLabel}>Department</span>
            <div className={styles.mobileChipRow}>
              <button className={`${styles.mobileChip} ${filterDept === 'all' ? styles.mobileChipActive : ''}`} onClick={() => setFilterDept('all')}>All</button>
              {allDepts.map(d => (
                <button key={d} className={`${styles.mobileChip} ${filterDept === d ? styles.mobileChipActive : ''}`} onClick={() => setFilterDept(d)}>{d}</button>
              ))}
            </div>
          </div>
        )}

        <div className={styles.mobileFilterActions}>
          {activeFilterCount > 0 && (
            <button
              className={styles.mobileFilterClear}
              onClick={() => {
                setFilterSearch(''); setFilterStatus('all')
                setFilterSeverity('all'); setDateRange('all'); setAreaMine(false)
                setFilterPlant('all'); setFilterDept('all')
              }}
            >Clear All</button>
          )}
          <button className={styles.mobileFilterApply} onClick={() => setFiltersOpen(false)}>
            Done
          </button>
        </div>
      </div>

    </div>
  )
}
