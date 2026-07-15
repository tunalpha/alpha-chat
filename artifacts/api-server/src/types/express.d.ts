// Estende il tipo Request di Express con le proprietà custom aggiunte dai middleware
declare namespace Express {
  interface Request {
    requestId?: string;
  }
}
