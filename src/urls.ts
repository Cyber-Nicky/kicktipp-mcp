export function urls(base = 'https://www.kicktipp.de') {
  const b = base.replace(/\/$/, '');
  const q = (n: number | undefined, key: string) => (n != null ? `?${key}=${n}` : '');
  return {
    base: () => b + '/',
    loginPage: () => `${b}/info/profil/login`,
    loginAction: () => `${b}/info/profil/loginaction`,
    meineTipprunden: () => `${b}/info/profil/meinetipprunden`,
    tippabgabe: (slug: string, md?: number) => `${b}/${slug}/tippabgabe${q(md, 'spieltagIndex')}`,
    tippuebersicht: (slug: string, md?: number) => `${b}/${slug}/tippuebersicht${q(md, 'spieltagIndex')}`,
    matchDetail: (slug: string, tippspielId: number) => `${b}/${slug}/tippuebersicht/spiel?tippspielId=${tippspielId}`,
    tabellen: (slug: string) => `${b}/${slug}/tabellen`,
    tippspielplan: (slug: string, md?: number) => `${b}/${slug}/tippspielplan${q(md, 'spieltagIndex')}`,
  };
}
export type Urls = ReturnType<typeof urls>;
