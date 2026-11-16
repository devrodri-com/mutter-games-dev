import Footer from '../components/Footer';
import './AboutPage.css';

export default function AboutPage() {
  return <div className="mutter-about">
    <main className="mutter-about-main">
      <section className="mutter-about-section" aria-labelledby="about-title">
        <p className="mutter-about-eyebrow">MUTTER GAMES &amp; COLECCIONABLES</p>
        <h1 id="about-title">Nuestra historia</h1>
        <div className="mutter-about-story">
          <p>Somos una tienda uruguaya con más de 20 años de experiencia en el comercio. Comenzamos en ferias barriales de La Teja a fines de los 90, cuando vender era tan simple como armar un puesto y atender con ganas.</p>
          <p>Luego abrimos uno de los primeros cibercafés del barrio, y con los años fuimos adaptándonos a las nuevas formas de vender. Hoy seguimos ese mismo espíritu, pero en el mundo digital.</p>
          <p>Con miles de ventas concretadas a través de Mercado Libre y una comunidad que confía en nuestros productos, damos un paso más: lanzamos nuestra tienda online para ofrecer una forma directa de comprar, con atención cercana.</p>
        </div>
        <p className="mutter-about-benefits">Trayectoria en Mercado Libre · Envíos a todo el país · Atención por WhatsApp</p>
        <div className="mutter-about-actions">
          <a className="mutter-about-primary" href="/shop">Ver tienda</a>
          <a className="mutter-about-secondary" href="https://www.instagram.com/muttergames/">Instagram</a>
        </div>
      </section>
    </main>
    <Footer />
  </div>;
}
