const PACKAGE_NAME = '@anionex/dsh-computer-use'
const PACKAGE_ADVISORIES = new Set(['non-org-recommended-name', 'not-in-hub'])

/** Enforce the aggregate gate while retaining the approved advisory details. */
export function assertPluginCheckReport(report, packageName, { allowHubWarning = false } = {}) {
  const errors = report?.errors ?? []
  const warnings = report?.warnings ?? []
  const validReport = report !== null && typeof report === 'object' && !Array.isArray(report)
    && Array.isArray(errors) && Array.isArray(warnings)
  const accepted = validReport && warnings.every(warning => {
    if (warning === null || typeof warning !== 'object' || Array.isArray(warning)) return false
    return (packageName === PACKAGE_NAME && PACKAGE_ADVISORIES.has(warning.code))
      || (allowHubWarning === true && warning.code === 'not-in-hub')
  })
  if (!validReport || report.verdict === 'fail' || errors.length > 0 || !accepted) {
    throw new Error(`dsh-plugin-check did not pass cleanly: ${JSON.stringify(report, null, 2)}`)
  }
  return [...warnings]
}
