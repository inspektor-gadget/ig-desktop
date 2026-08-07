// Copyright 2026 The Inspektor Gadget authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package virtual

import (
	"fmt"
	"maps"
	"strings"

	"github.com/inspektor-gadget/inspektor-gadget/pkg/datasource"
	datasourceexpr "github.com/inspektor-gadget/inspektor-gadget/pkg/datasource/expr"
	"github.com/inspektor-gadget/inspektor-gadget/pkg/gadget-service/api"
	"github.com/inspektor-gadget/inspektor-gadget/pkg/operators"
	"github.com/inspektor-gadget/inspektor-gadget/pkg/operators/simple"
	"gopkg.in/yaml.v3"
)

const (
	Name     = "virtual"
	Priority = 999

	AnnotationFields      = "virtual.fields"
	AnnotationContent     = "virtual.content"
	AnnotationContentExpr = "virtual.content-expr"
)

type setter func(datasource.Data) error

type fieldConfig struct {
	Type        string            `yaml:"type"`
	Content     *string           `yaml:"virtual.content"`
	ContentExpr string            `yaml:"virtual.content-expr"`
	Annotations map[string]string `yaml:"annotations"`
}

type metadata struct {
	Datasources map[string]struct {
		Fields map[string]fieldConfig `yaml:"fields"`
	} `yaml:"datasources"`
}

func New() operators.DataOperator {
	setters := make(map[datasource.DataSource][]setter)

	return simple.New(Name,
		simple.WithPriority(Priority),
		simple.OnInit(func(gadgetCtx operators.GadgetContext) error {
			gadgetInfo, err := gadgetCtx.SerializeGadgetInfo(false)
			if err != nil {
				return fmt.Errorf("serializing gadget info: %w", err)
			}
			var config metadata
			if err := yaml.Unmarshal(gadgetInfo.Metadata, &config); err != nil {
				return fmt.Errorf("parsing gadget metadata: %w", err)
			}

			for _, ds := range gadgetCtx.GetDataSources() {
				for fieldName := range strings.SplitSeq(ds.Annotations()[AnnotationFields], ",") {
					fieldName = strings.TrimSpace(fieldName)
					if fieldName == "" {
						continue
					}

					fieldConfig, ok := config.Datasources[ds.Name()].Fields[fieldName]
					if !ok {
						return fmt.Errorf("virtual field %q is not defined in datasource %q metadata", fieldName, ds.Name())
					}
					if fieldConfig.Type != "" && !strings.EqualFold(fieldConfig.Type, "string") {
						return fmt.Errorf("virtual field %q has unsupported type %q", fieldName, fieldConfig.Type)
					}

					annotations := maps.Clone(fieldConfig.Annotations)
					if annotations == nil {
						annotations = make(map[string]string)
					}
					if fieldConfig.Content != nil {
						annotations[AnnotationContent] = *fieldConfig.Content
					}
					if fieldConfig.ContentExpr != "" {
						annotations[AnnotationContentExpr] = fieldConfig.ContentExpr
					}

					field, err := ds.AddField(fieldName, api.Kind_String, datasource.WithAnnotations(annotations))
					if err != nil {
						return fmt.Errorf("adding virtual field %q to datasource %q: %w", fieldName, ds.Name(), err)
					}

					if expression := annotations[AnnotationContentExpr]; expression != "" {
						program, err := datasourceexpr.CompileStringProgram(ds, expression)
						if err != nil {
							return fmt.Errorf("compiling virtual field %q expression: %w", field.FullName(), err)
						}
						setters[ds] = append(setters[ds], func(data datasource.Data) error {
							value, err := datasourceexpr.Run(program, data)
							if err != nil {
								return fmt.Errorf("evaluating virtual field %q expression: %w", field.FullName(), err)
							}
							stringValue, ok := value.(string)
							if !ok {
								return fmt.Errorf(
									"virtual field %q expression returned %T, expected string",
									field.FullName(),
									value,
								)
							}
							return field.PutString(data, stringValue)
						})
						continue
					}

					content, ok := annotations[AnnotationContent]
					if !ok {
						return fmt.Errorf("virtual field %q has neither %q nor %q", field.FullName(), AnnotationContent, AnnotationContentExpr)
					}
					setters[ds] = append(setters[ds], func(data datasource.Data) error {
						return field.PutString(data, content)
					})
				}
			}
			return nil
		}),
		simple.OnPreStart(func(operators.GadgetContext) error {
			for ds, fieldSetters := range setters {
				if err := ds.Subscribe(func(_ datasource.DataSource, data datasource.Data) error {
					for _, set := range fieldSetters {
						if err := set(data); err != nil {
							return err
						}
					}
					return nil
				}, 0); err != nil {
					return fmt.Errorf("subscribing virtual fields for datasource %q: %w", ds.Name(), err)
				}
			}
			return nil
		}),
	)
}
