package modelmanagement

import "yap/internal/models"

type ModelCatalog struct {
	Models                 []models.Model     `json:"models"`
	TextModels             []models.TextModel `json:"textModels"`
	TextRuntimeAvailable   bool               `json:"textRuntimeAvailable"`
	RecommendedTextContext int                `json:"recommendedTextContext"`
}

func Catalog(dir string) ModelCatalog {
	return ModelCatalog{Models: models.List(dir), TextModels: models.ListTextModels(dir), TextRuntimeAvailable: models.TextRuntimeAvailable(), RecommendedTextContext: models.RecommendedTextContext()}
}
