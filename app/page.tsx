export default function HomePage() {
  return (
    <main
      style={{
        width: "100%",
        minHeight: "100vh",
        margin: 0,
        padding: 0,
        background: "#ffffff",
      }}
    >
      <iframe
        src="/demo-ui/interface-base.html"
        title="Becarb Control de Atrasos"
        style={{
          width: "100%",
          height: "100vh",
          border: "none",
          display: "block",
        }}
      />
    </main>
  );
}