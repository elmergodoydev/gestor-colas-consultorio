import { Box, Container, Typography } from "@mui/material";

export default function BibliotecaVideos() {
  return (
    <Container maxWidth="lg" sx={{ py: { xs: 3, md: 5 } }}>
      <Box>
        <Typography
          variant="overline"
          color="primary"
          fontWeight={700}
        >
          GESTOR DE COLAS · ADMINISTRACIÓN
        </Typography>

        <Typography variant="h4" fontWeight={700} sx={{ mt: 1 }}>
          Biblioteca de videos
        </Typography>

        <Typography color="text.secondary" sx={{ mt: 1 }}>
          Aquí centralizaremos los videos para reutilizarlos en las
          listas de reproducción de los monitores.
        </Typography>
      </Box>
    </Container>
  );
}