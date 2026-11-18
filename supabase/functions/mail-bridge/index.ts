import { createMailHandler } from '../_shared/mail-service.ts';
Deno.serve(createMailHandler(Deno.env.toObject()));
