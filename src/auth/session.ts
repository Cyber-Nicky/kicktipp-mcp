import { Http } from '../http/client.js';
import { urls } from '../urls.js';
import { AuthError } from '../errors.js';
import type { Keychain } from './keychain.js';
import * as cheerio from 'cheerio';

interface SessionOpts {
  email: string;
  password: string;
  keychain: Keychain;
  base?: string;
  makeHttp?: (cookies: Record<string, string>) => Http;
}

export class Session {
  private u;
  private _http: Http | null = null;

  constructor(private o: SessionOpts) {
    this.u = urls(o.base);
  }

  private key() {
    return `kicktipp:${this.o.email}`;
  }

  private make(cookies: Record<string, string>) {
    return this.o.makeHttp ? this.o.makeHttp(cookies) : new Http({ cookies });
  }

  async login(): Promise<void> {
    const http = this.make({});
    const page = await http.get(this.u.loginPage());
    const action =
      cheerio.load(page.html)('form:has(input[name="kennung"])').attr('action') || '/info/profil/loginaction';
    const res = await http.postForm(new URL(action, this.u.loginPage()).toString(), {
      kennung: this.o.email,
      passwort: this.o.password,
      submitbutton: 'Anmelden',
    });
    if (!http.cookies().login) throw new AuthError('login failed: no login cookie set');
    this._http = http;
    await this.o.keychain.set(this.key(), JSON.stringify(http.cookies()));
    void res;
  }

  async http(): Promise<Http> {
    if (this._http) return this._http;
    const saved = await this.o.keychain.get(this.key());
    if (saved) {
      const http = this.make(JSON.parse(saved));
      if (await this.isValid(http)) {
        this._http = http;
        return http;
      }
    }
    await this.login();
    return this._http!;
  }

  private async isValid(http: Http): Promise<boolean> {
    const r = await http.get(this.u.base());
    return !/\/login/.test(r.finalUrl) && !/name=["']?kennung/.test(r.html);
  }
}
