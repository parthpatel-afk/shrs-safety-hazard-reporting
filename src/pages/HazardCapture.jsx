import { useState, useRef } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Camera, Upload, X, CheckCircle, AlertTriangle } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useCompany } from '../hooks/useCompany'
import styles from './HazardCapture.module.css'

const HAZARD_TYPES = [
  'Slip / Trip Hazard',
  'Electrical Hazard',
  'Fire Hazard',
  'Chemical Spill',
  'Equipment Damage',
  'Structural Damage',
  'Ergonomic Hazard',
  'Environmental Hazard',
  'Near Miss',
  'Other',
]

const SEVERITY_META = {
  Low:      { color: 'var(--severity-low)',      label: 'Low',      desc: 'Minor — no immediate danger' },
  Medium:   { color: 'var(--severity-medium)',   label: 'Medium',   desc: 'Moderate — action needed soon' },
  High:     { color: 'var(--severity-high)',     label: 'High',     desc: 'Serious — address today' },
  Critical: { color: 'var(--severity-critical)', label: 'Critical', desc: 'Immediate danger — stop work' },
}

/** Compress an image file via canvas to a max dimension and quality */
function compressImage(file, maxDim = 1200, quality = 0.82) {
  return new Promise((resolve) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      let { width, height } = img
      if (width > maxDim || height > maxDim) {
        if (width > height) { height = Math.round((height * maxDim) / width); width = maxDim }
        else                { width  = Math.round((width  * maxDim) / height); height = maxDim }
      }
      const canvas = document.createElement('canvas')
      canvas.width = width; canvas.height = height
      canvas.getContext('2d').drawImage(img, 0, 0, width, height)
      canvas.toBlob(blob => resolve(blob), 'image/jpeg', quality)
    }
    img.src = url
  })
}

export default function HazardCapture() {
  const { companySlug } = useParams()
  const [searchParams]  = useSearchParams()
  const { company, loading: companyLoading } = useCompany(companySlug)
  const navigate = useNavigate()

  const plant      = searchParams.get('plant')      || ''
  const department = searchParams.get('department') || ''
  const zone       = searchParams.get('zone')       || ''
  const area       = searchParams.get('area')       || ''

  const fileInputRef = useRef(null)

  const [photoFile, setPhotoFile]         = useState(null)   // compressed Blob
  const [photoPreview, setPhotoPreview]   = useState(null)   // object URL for preview
  const [photoName, setPhotoName]         = useState('')
  const [hazardType, setHazardType]       = useState('')
  const [severity, setSeverity]           = useState('Medium')
  const [description, setDescription]     = useState('')
  const [reporterName, setReporterName]   = useState('')
  const [submitting, setSubmitting]       = useState(false)
  const [submitted, setSubmitted]         = useState(false)
  const [error, setError]                 = useState('')

  async function handleFileChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const compressed = await compressImage(file)
    const name = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
    setPhotoFile(compressed)
    setPhotoName(name)
    setPhotoPreview(URL.createObjectURL(compressed))
  }

  function clearPhoto() {
    setPhotoFile(null)
    setPhotoPreview(null)
    setPhotoName('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!hazardType) { setError('Please select a hazard type.'); return }
    setError('')
    setSubmitting(true)

    try {
      let photoUrl = ''

      // Upload photo if one was taken
      if (photoFile && photoName) {
        const { data: uploadData, error: uploadErr } = await supabase.storage
          .from('hazard-photos')
          .upload(photoName, photoFile, { contentType: 'image/jpeg', upsert: false })
        if (uploadErr) throw new Error(`Photo upload failed: ${uploadErr.message}`)
        const { data: publicUrlData } = supabase.storage
          .from('hazard-photos')
          .getPublicUrl(uploadData.path)
        photoUrl = publicUrlData.publicUrl
      }

      // Insert hazard report
      const { error: insertErr } = await supabase
        .from('hazard_reports')
        .insert({
          company_id:    company.id,
          plant,
          department,
          zone,
          area,
          hazard_type:   hazardType,
          severity,
          description:   description.trim(),
          photo_url:     photoUrl,
          reporter_name: reporterName.trim() || 'Anonymous',
          status:        'Open',
        })
      if (insertErr) throw new Error(insertErr.message)

      setSubmitted(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  if (companyLoading) return <div className={styles.page} />

  const locationStr = [plant, department, zone, area]
    .filter(v => v && v !== 'N/A').join(' › ') || 'No location selected'

  // ── Top bar (shared between success + main form) ───────────
  const TopBar = () => (
    <header className={styles.topBar}>
      <div className={styles.topBarLeft}>
        <button className={styles.backBtn} onClick={() => navigate(`/report/${companySlug}`)} aria-label="Back">‹</button>
        <button className={styles.topBarBrand} onClick={() => navigate(`/${companySlug}`)} title="Home">
          {company?.logo_url && (
            <img src={company.logo_url} alt={`${company.name} logo`} className={styles.topBarLogo} />
          )}
          <div>
            <p className={styles.topBarCompany}>{company?.name || 'AutoRise'}</p>
            <p className={styles.topBarTitle}>Hazard Report</p>
          </div>
        </button>
        <span className={styles.locationBar}>{locationStr}</span>
      </div>
    </header>
  )

  // ── Success screen ─────────────────────────────────────────
  if (submitted) {
    return (
      <div className={styles.page}>
        <TopBar />
        <div className={styles.pageContent}>
          <div className={styles.successCard}>
            <div className={styles.successIcon}>
              <CheckCircle size={48} color="var(--severity-low)" />
            </div>
            <h2 className={styles.successTitle}>Report Submitted</h2>
            <p className={styles.successMsg}>
              Your hazard report has been logged and the safety team will be notified.
              Thank you for keeping the workplace safe.
            </p>
            <button
              className={styles.btn}
              onClick={() => navigate(`/${companySlug}`)}
            >
              ← Back to Home
            </button>
            <button
              className={styles.btnSecondary}
              onClick={() => navigate(`/report/${companySlug}`)}
            >
              Report Another Hazard
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Main form ──────────────────────────────────────────────
  return (
    <div className={styles.page}>
      <TopBar />

      <div className={styles.pageContent}>
        <div className={styles.card}>
          <h1 className={styles.title}>Hazard Details</h1>
          <p className={styles.locationBadge}>{locationStr}</p>

          <form className={styles.form} onSubmit={handleSubmit}>
            <div className={styles.formGrid}>

              {/* ── LEFT COLUMN ── */}
              <div className={styles.formCol}>

                {/* ── Photo Capture ── */}
                <div className={styles.section}>
                  <p className={styles.sectionLabel}>Photo <span className={styles.optional}>(recommended)</span></p>
                  {!photoPreview ? (
                    <div className={styles.photoArea} onClick={() => fileInputRef.current?.click()}>
                      <Camera size={32} color="var(--text-muted)" />
                      <p className={styles.photoHint}>Tap to take a photo or upload</p>
                      <p className={styles.photoSub}>Camera will open on mobile</p>
                    </div>
                  ) : (
                    <div className={styles.photoPreviewWrap}>
                      <img src={photoPreview} alt="Hazard photo" className={styles.photoPreview} />
                      <button type="button" className={styles.photoRemove} onClick={clearPhoto}>
                        <X size={16} />
                      </button>
                    </div>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className={styles.fileInput}
                    onChange={handleFileChange}
                  />
                  {!photoPreview && (
                    <button
                      type="button"
                      className={styles.uploadBtn}
                      onClick={() => {
                        if (fileInputRef.current) {
                          fileInputRef.current.removeAttribute('capture')
                          fileInputRef.current.click()
                          setTimeout(() => fileInputRef.current?.setAttribute('capture', 'environment'), 500)
                        }
                      }}
                    >
                      <Upload size={14} /> Upload from gallery
                    </button>
                  )}
                </div>

                {/* ── Hazard Type ── */}
                <div className={styles.section}>
                  <p className={styles.sectionLabel}>Hazard Type <span className={styles.required}>*</span></p>
                  <div className={styles.typeGrid}>
                    {HAZARD_TYPES.map(type => (
                      <button
                        key={type}
                        type="button"
                        className={`${styles.typeBtn} ${hazardType === type ? styles.typeBtnActive : ''}`}
                        onClick={() => setHazardType(type)}
                      >
                        {type}
                      </button>
                    ))}
                  </div>
                </div>

              </div>

              {/* ── RIGHT COLUMN ── */}
              <div className={styles.formCol}>

                {/* ── Severity ── */}
                <div className={styles.section}>
                  <p className={styles.sectionLabel}>Severity <span className={styles.required}>*</span></p>
                  <div className={styles.severityRow}>
                    {Object.entries(SEVERITY_META).map(([key, meta]) => (
                      <button
                        key={key}
                        type="button"
                        className={`${styles.severityBtn} ${severity === key ? styles.severityBtnActive : ''}`}
                        style={severity === key ? { background: meta.color, borderColor: meta.color, color: '#fff' } : { borderColor: meta.color, color: meta.color }}
                        onClick={() => setSeverity(key)}
                      >
                        <span className={styles.severityLabel}>{meta.label}</span>
                        <span className={styles.severityDesc}>{meta.desc}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* ── Description ── */}
                <div className={styles.section}>
                  <label className={styles.sectionLabel} htmlFor="description">
                    Description <span className={styles.optional}>(optional)</span>
                  </label>
                  <textarea
                    id="description"
                    className={styles.textarea}
                    rows={4}
                    placeholder="Briefly describe the hazard — what you saw, where exactly, any relevant details…"
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    maxLength={500}
                  />
                  <p className={styles.charCount}>{description.length}/500</p>
                </div>

                {/* ── Reporter Name ── */}
                <div className={styles.section}>
                  <label className={styles.sectionLabel} htmlFor="reporter">
                    Your Name <span className={styles.optional}>(optional — leave blank to stay anonymous)</span>
                  </label>
                  <input
                    id="reporter"
                    type="text"
                    className={styles.input}
                    placeholder="Anonymous"
                    value={reporterName}
                    onChange={e => setReporterName(e.target.value)}
                    maxLength={80}
                  />
                </div>

                {/* ── Warning + Error + Submit ── */}
                {!hazardType && (
                  <p className={styles.typeWarning}>
                    <AlertTriangle size={14} /> Select a hazard type above to submit
                  </p>
                )}

                {error && <p className={styles.error}>{error}</p>}

                <button
                  type="submit"
                  className={styles.btn}
                  disabled={submitting || !hazardType}
                >
                  {submitting ? 'Submitting Report…' : 'Submit Hazard Report →'}
                </button>

              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
