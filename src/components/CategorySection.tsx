import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import styles from "./CategorySection.module.css";

const categories = [
  {
    name: "PlayStation",
    image: "/images/categories/playstation-mobile-a.webp",
    href: "/shop?cat=oSOjLi6kEye6tCY1l8UC",
    description: "Consolas, juegos y accesorios",
    presentation: "playstation",
    brand: true,
  },
  {
    name: "Xbox",
    image: "/images/categories/xbox-oscuro.webp",
    href: "/shop?cat=p7szeIMsdtyOGsvrd8iU",
    description: "Consolas, juegos y accesorios",
    presentation: "xbox",
    brand: true,
  },
  {
    name: "Nintendo",
    image: "/images/categories/nintendo-oscuro.webp",
    href: "/shop?cat=jgslGXmUTykbxU9Rznwn",
    description: "Consolas, juegos y accesorios",
    presentation: "nintendo",
    brand: true,
  },
  {
    name: "Portátiles",
    image: "/images/categories/portatiles-uniforme.webp",
    href: "/shop?sub=3RJv33CqADoyhYnNMaHZ&sub=EeGW6jqNfl6FrLT6NUrA&sub=gqvis4odi0Tjp0Ra3Vir&sub=puircuX8w8LtWA9y0Vzg",
    description: "Consolas, juegos y accesorios",
    presentation: "photo",
    brand: false,
  },
  {
    name: "Retro / Otros",
    image: "/images/categories/retro-uniforme.webp",
    href: "/shop?cat=by3pj0mhQjby9Qj019ST&cat=SjEJ55X4EuhOU67Xc4TE",
    description: "Juegos y consolas de otras épocas",
    presentation: "photo",
    brand: false,
  },
  {
    name: "Coleccionables",
    image: "/images/categories/coleccionables-uniforme.webp",
    href: "/shop?cat=mDCgXzKnEXa7LsNZyUve",
    description: "Figuras, películas, música y más",
    presentation: "photo",
    brand: false,
  },
];

export default function CategorySection() {
  return (
    <section id="catalogo" aria-labelledby="category-heading" className={styles.section}>
      <Helmet>
        <title>Categorías | Mutter Games</title>
        <meta name="keywords" content="juegos, consolas, coleccionables, PlayStation, Xbox, Nintendo, retro" />
        <meta name="description" content="Explorá nuestras categorías de consolas y coleccionables. PlayStation, Xbox, Nintendo, retro y más en Mutter Games." />
      </Helmet>

      <div className={styles.container}>
        <header className={styles.heading}>
          <h2 id="category-heading">Explorar por categoría</h2>
          <p>Consolas, juegos y coleccionables.</p>
        </header>

        <div className={styles.grid}>
          {categories.map(({ name, image, href, description, presentation, brand }) => (
            <Link
              key={name}
              to={href}
              aria-label={`Ver categoría ${name}`}
              className={`${styles.card} ${styles[presentation]}`}
            >
              <div className={styles.media}>
                <img src={image} alt="" width={500} height={500} loading="lazy" decoding="async" className={styles.image} />
              </div>
              <div className={styles.cardBody}>
                <div className={styles.cardText}>
                  <h3 className={brand ? styles.brandTitle : styles.cardTitle}>{name}</h3>
                  <p className={styles.description}>{description}</p>
                  <span className={styles.mobileAction}>Ver categoría</span>
                </div>
                <ArrowUpRight className={styles.arrow} size={24} strokeWidth={1.6} aria-hidden="true" />
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
