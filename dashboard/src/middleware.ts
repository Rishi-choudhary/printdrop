import { NextRequest, NextResponse } from 'next/server';

const AUTH_COOKIE_NAME = 'pd_session';

type SessionUser = {
  role?: string;
};

async function getSessionUser(request: NextRequest): Promise<SessionUser | null> {
  const cookie = request.headers.get('cookie');
  if (!cookie || !request.cookies.get(AUTH_COOKIE_NAME)?.value) return null;

  try {
    const url = new URL('/api/auth/me', request.url);
    const response = await fetch(url, {
      headers: { cookie },
      cache: 'no-store',
    });

    if (!response.ok) return null;

    const data = (await response.json()) as { user?: SessionUser };
    return data.user ?? null;
  } catch {
    return null;
  }
}

function redirectToLogin(request: NextRequest) {
  const loginUrl = new URL('/login', request.url);
  loginUrl.searchParams.set('redirect', `${request.nextUrl.pathname}${request.nextUrl.search}`);

  const response = NextResponse.redirect(loginUrl);
  response.cookies.delete(AUTH_COOKIE_NAME);
  return response;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const user = await getSessionUser(request);

  if (pathname === '/login') {
    if (!user) return NextResponse.next();
    return NextResponse.redirect(new URL(user.role === 'admin' ? '/admin' : '/dashboard', request.url));
  }

  if (!user) return redirectToLogin(request);

  if (pathname.startsWith('/admin') && user.role !== 'admin') {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  if (pathname.startsWith('/dashboard') && !['admin', 'shopkeeper'].includes(user.role ?? '')) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/login', '/dashboard/:path*', '/admin/:path*'],
};
