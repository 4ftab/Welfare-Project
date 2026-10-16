import { useLanguage } from "../languageContext";
import "./Navbar.css";

function Navbar() {
  const { language, toggleLanguage, t } = useLanguage();

  return (
    <nav className="welfare-navbar">
      <div className="welfare-brand">
        <span className="welfare-logo">❤</span>
        <span>{t("siteName")}</span>
      </div>

      <div className="welfare-nav-links">
        <a href="#home">{t("home")}</a>
        <a href="#about">{t("about")}</a>
        <a href="#projects">{t("projects")}</a>
        <a href="#contact">{t("contact")}</a>

        <button
          type="button"
          className="language-button"
          onClick={toggleLanguage}
          aria-label="Change website language"
        >
          {language === "en" ? "اردو" : "English"}
        </button>
      </div>
    </nav>
  );
}

export default Navbar;