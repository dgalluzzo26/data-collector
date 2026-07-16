export function isDhsAgency(agencyName: string): boolean {
  return agencyName.trim().toLowerCase() === 'u.s. department of homeland security';
}

export function defaultBrandLogos(agencyName: string) {
  if (isDhsAgency(agencyName)) {
    return {
      icon: '/images/dhs-logo.svg',
      wordmark: '/images/dhs-wordmark.svg',
      label: 'DHS wordmark',
    };
  }
  return {
    icon: '/images/databricks-icon.svg',
    wordmark: '/images/databricks-wordmark.svg',
    label: 'Databricks wordmark',
  };
}
