import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Layout() {
  const { user, logout } = useAuth();

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">Domino Designer</div>
        <nav>
          <NavLink to="/inventory">Inventory</NavLink>
          <NavLink to="/designs">Designs</NavLink>
          <NavLink to="/import">Import Image</NavLink>
        </nav>
        <div className="user-area">
          <span>{user?.username}</span>
          <button onClick={() => logout()}>Log out</button>
        </div>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
