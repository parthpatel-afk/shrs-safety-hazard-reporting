import { useNavigate, useParams } from 'react-router-dom'
import { useCompany } from '../hooks/useCompany'
import styles from './Home.module.css'

export default function Home() {
  const { companySlug } = useParams()
  const { company, loading } = useCompany(companySlug)
  const navigate = useNavigate()

  if (loading) return <div className={styles.page} />

  return (
    <div className={styles.page}>
      <div className={styles.inner}>

        {/* Brand */}
        <div className={styles.brandWrap}>
          {company?.logo_url && (
            <img
              src={company.logo_url}
              alt={`${company.name} logo`}
              className={styles.companyLogo}
            />
          )}
          <p className={styles.brandName}>{company?.name ?? companySlug}</p>
          <h1 className={styles.headline}>Safety Hazard<br />Reporting System</h1>
          <p className={styles.tagline}>See something. Say something. Submit it here.</p>
        </div>

        {/* Two cards */}
        <div className={styles.cards}>

          <button
            className={`${styles.card} ${styles.cardReport}`}
            onClick={() => navigate(`/report/${companySlug}`)}
          >
            <span className={styles.cardIcon}>⚠️</span>
            <span className={styles.cardTitle}>Report a Hazard</span>
            <span className={styles.cardDesc}>
              Employees — tap to report a safety hazard, near miss, or unsafe condition.
            </span>
            <span className={styles.cardCta}>Get Started →</span>
          </button>

          <button
            className={`${styles.card} ${styles.cardDashboard}`}
            onClick={() => navigate(`/admin/${companySlug}`)}
          >
            <span className={styles.cardIcon}>🛡️</span>
            <span className={styles.cardTitle}>Safety Dashboard</span>
            <span className={styles.cardDesc}>
              Safety team — log in to review, action, and track open hazard reports.
            </span>
            <span className={styles.cardCta}>Log In →</span>
          </button>

        </div>

        {/* Register link */}
        <p className={styles.registerHint}>
          New safety team member?{' '}
          <button className={styles.registerLink} onClick={() => navigate(`/register/${companySlug}`)}>
            Create an account
          </button>
        </p>

      </div>
    </div>
  )
}
