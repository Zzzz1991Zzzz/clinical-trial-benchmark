import React from 'react'
import { Link, useLocation } from 'react-router-dom'
import logo from '../assets/ct-open-logo.png'

function Header({ user, onLogout }) {
  const location = useLocation()
  const isActive = (path) => location.pathname === path ? 'active' : ''

  return (
    <header className="header">
      <div className="header-inner">
        <Link to="/" className="header-logo">
          <img src={logo} alt="CT Open Challenge" className="header-logo-image" />
        </Link>

        <nav className="header-nav">
          <Link to="/" className={isActive('/')}>Benchmarks</Link>
          <Link to="/about" className={isActive('/about')}>Instructions</Link>
          {user ? (
            <>
              <Link to="/submit" className={isActive('/submit')}>Submit</Link>
              <Link to="/my-submissions" className={isActive('/my-submissions')}>History</Link>
              {!user.email_verified && (
                <Link to="/verify-email" className={isActive('/verify-email')}>Verify Email</Link>
              )}
              {user.role === 'admin' && (
                <Link to="/admin" className={isActive('/admin')}>Admin</Link>
              )}
              <button type="button" onClick={onLogout}>
                {user.username} · Logout
              </button>
            </>
          ) : (
            <>
              <Link to="/login" className={isActive('/login')}>Login</Link>
              <Link to="/register" className={isActive('/register')}>Create Account</Link>
            </>
          )}
        </nav>
      </div>
    </header>
  )
}

export default Header
