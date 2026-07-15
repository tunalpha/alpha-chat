// Estende il tipo Request di Express con le proprietà custom aggiunte dai middleware

declare namespace Express {
  interface Request {
    requestId?: string;

    /**
     * Payload del JWT verificato — popolato dal middleware `authenticate`.
     * Undefined sulle route pubbliche (register, login, refresh).
     */
    user?: {
      userId: string;
      deviceId: string;
      roles: string[];
      jti: string;
      accessTokenExpiresAt: Date;
    };
  }
}
